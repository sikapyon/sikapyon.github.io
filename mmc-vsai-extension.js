/* mmc-vsai-extension.js — 対AI拡張（基準共有 + 2人対戦スコア + バグ修正 + 思考強化） */
(function(){
  function $(id){ return document.getElementById(id); }
  var modeSel = $('mode');
  if(!modeSel){ console.warn('[vsAI] #mode が見つかりません。'); return; }

  /* ------ モード選択に「対AI」を追加 ------ */
  (function(){
    var has=false; for(var i=0;i<modeSel.options.length;i++){ if(modeSel.options[i].value==='vsai'){ has=true; break; } }
    if(!has){ var opt=document.createElement('option'); opt.value='vsai'; opt.textContent='対AI（ふつう）'; modeSel.appendChild(opt); }
  })();

  /* ------ 追加CSS（本体の .white/.grey と衝突しない AI 専用クラス） ------ */
  (function(){
    var css=''
      + '.vsai-dual{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap;}'
      + '.vsai-dual .boardWrap{flex:0 0 auto;position:relative;}'
      + '.aiWrap .cell{pointer-events:none}'
      + '.aiWrap .aiTag{position:absolute;top:-22px;left:0;font-weight:600;color:#667}'
      + '.aiWrap .lines{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none}'
      + '.vsai-score h3{margin:.3em 0}'
      + '.vsai-score .tbl td,.vsai-score .tbl th{min-width:90px}'
      + '@media (max-width:900px){.vsai-dual{gap:14px;}}'
    var st=document.createElement('style'); st.type='text/css';
    if(st.styleSheet){ st.styleSheet.cssText=css; } else { st.appendChild(document.createTextNode(css)); }
    document.head.appendChild(st);
  })();

  /* ------ 共有状態 ------ */
  var frontierNumbers=[21,1,22,2,23,3,24,4,25];
  var vsAI={
    enabled:false,
    sharedBaseline:12,
    usedHuman:(function(){ var s=new Set(); s.add(12); return s; })(),
    usedAI:(function(){ var s=new Set(); s.add(12); return s; })(),
    fallback:null, // null / 'AI' / 'HUMAN'
    ai:{
      vals:[], chosen:[], path:[],
      res:{food:0,sci:0,ind:0,art:0,dip:0,inv:0},
      research:(function(){ var a=[]; for(var i=0;i<12;i++) a.push(null); return a; })(),
      frontierX:new Set(), used:(function(){ var s=new Set(); s.add(12); return s; })(),
      tour:[]
    }
  };

  var dualHost=null, origBoardWrap=null, aiWrap=null, aiBoard=null, aiLines=null, whiteMask=null;

  /* ------ AI観戦パネル ------ */
  function ensureAIPanel(){
    if(dualHost) return;
    var mainCard = $('board') && $('board').closest ? $('board').closest('.card') : $('board').parentElement;
    origBoardWrap = $('board').parentElement;
    dualHost = document.createElement('div'); dualHost.className='vsai-dual';
    mainCard.insertBefore(dualHost, origBoardWrap);
    dualHost.appendChild(origBoardWrap);

    aiWrap=document.createElement('div'); aiWrap.className='boardWrap aiWrap';
    aiBoard=document.createElement('div'); aiBoard.className='grid'; aiBoard.id='aiBoardView';
    aiLines=document.createElementNS('http://www.w3.org/2000/svg','svg'); aiLines.setAttribute('class','lines');
    var tag=document.createElement('div'); tag.className='aiTag'; text= 'AI'; tag.textContent=text;
    aiWrap.appendChild(aiBoard); aiWrap.appendChild(aiLines); aiWrap.appendChild(tag);
    dualHost.appendChild(aiWrap);

    var humanCells=$('board').querySelectorAll('.cell'), i,j,k;
    whiteMask=[]; for(i=0;i<5;i++){ whiteMask[i]=[]; for(j=0;j<5;j++) whiteMask[i][j]=false; }
    aiBoard.innerHTML='';
    for(k=0;k<humanCells.length;k++){
      var c=humanCells[k]; i=+c.dataset.i; j=+c.dataset.j;
      var isWhite=c.classList.contains('white'); whiteMask[i][j]=isWhite;
      var d = document.createElement('div'); d.className = 'cell ' + (isWhite ? 'white' : 'grey');
      d.dataset.i=i; d.dataset.j=j; d.dataset.value='';
      aiBoard.appendChild(d);
    }
    fitAiSVG(false);
  }
  function removeAIPanel(){
    if(!dualHost) return;
    var parent=dualHost.parentElement;
    parent.insertBefore(origBoardWrap,dualHost);
    dualHost.parentElement.removeChild(dualHost);
    dualHost=null; aiWrap=null; aiBoard=null; aiLines=null;
  }

  /* ------ 満了検出 ------ */
  function isHumanFull(){
    var wrap = $('board'); if(!wrap) return false;
    return wrap.querySelectorAll('.cell.chosen').length >= 25;
  }
  function isAIFull(){
    var cnt=0;
    for(var i=0;i<5;i++)for(var j=0;j<5;j++){
      if(vsAI.ai.chosen[i] && vsAI.ai.chosen[i][j]) cnt++;
    }
    return cnt >= 25;
  }

  /* ------ 線描画（非隣接は描かない） ------ */
  function fitAiSVG(animate){
    if(!aiBoard || !aiLines) return;
    var rect=aiBoard.getBoundingClientRect();
    aiLines.setAttribute('viewBox','0 0 '+rect.width+' '+rect.height);
    while(aiLines.firstChild) aiLines.removeChild(aiLines.firstChild);
    var path=vsAI.ai.path||[];
    if(path.length<=1) return;
    var s=parseFloat(getComputedStyle(aiBoard).getPropertyValue('--size'))||64;
    var g=parseFloat(getComputedStyle(aiBoard).getPropertyValue('--gap'))||8;
    function center(p){ return {x:p[1]*(s+g)+s/2, y:p[0]*(s+g)+s/2}; }
    function segLen(ax,ay,bx,by){ var dx=bx-ax, dy=by-ay; return Math.sqrt(dx*dx+dy*dy); }

    for(var k=1;k<path.length;k++){
      var pA = path[k-1], pB = path[k];
      var di = Math.abs(pA[0]-pB[0]), dj = Math.abs(pA[1]-pB[1]);
      if(di>1 || dj>1 || (di===0 && dj===0)) continue;
      var a=center(pA), b=center(pB);
      var L=document.createElementNS('http://www.w3.org/2000/svg','line');
      L.setAttribute('x1',a.x); L.setAttribute('y1',a.y);
      L.setAttribute('x2',b.x); L.setAttribute('y2',b.y);
      L.setAttribute('stroke','#6a8cff'); L.setAttribute('stroke-width','3');
      if(animate && k===path.length-1){
        var len=segLen(a.x,a.y,b.x,b.y);
        L.style.strokeDasharray=len; L.style.strokeDashoffset=len;
        try{ L.animate([{strokeDashoffset:len},{strokeDashoffset:0}],{duration:350,fill:'forwards',easing:'ease'}); }catch(e){}
      }
      aiLines.appendChild(L);
    }
  }
  function renderAIBoard(animate){
    if(!aiBoard) return;
    var cells=aiBoard.querySelectorAll('.cell');
    for(var k=0;k<cells.length;k++){
      var c=cells[k], i=+c.dataset.i, j=+c.dataset.j;
      var v=(vsAI.ai.vals[i]&&vsAI.ai.vals[i][j])? vsAI.ai.vals[i][j] : '';
      c.dataset.value=v; c.textContent=v;
      var chosen=(vsAI.ai.chosen[i]&&vsAI.ai.chosen[i][j])? true:false;
      c.classList.toggle('chosen',!!chosen);
    }
    fitAiSVG(animate);
  }

  function shuffle(a){ for(var k=a.length-1;k>0;k--){ var j=Math.floor(Math.random()*(k+1)); var t=a[k]; a[k]=a[j]; a[j]=t; } return a; }
  function buildAIBoardFromMask(){
    if(!whiteMask) ensureAIPanel();
    var nums=[]; for(var n=5;n<=20;n++) nums.push(n); shuffle(nums); var idx=0;
    var i,j;
    vsAI.ai.vals=[]; vsAI.ai.chosen=[]; vsAI.ai.path=[]; vsAI.ai.tour=[];
    for(i=0;i<5;i++){ vsAI.ai.vals[i]=[]; vsAI.ai.chosen[i]=[]; for(j=0;j<5;j++){ vsAI.ai.vals[i][j]=''; vsAI.ai.chosen[i][j]=false; } }
    vsAI.ai.res={food:0,sci:0,ind:0,art:0,dip:0,inv:0};
    vsAI.ai.research=[]; for(i=0;i<12;i++) vsAI.ai.research[i]=null;
    vsAI.ai.frontierX=new Set(); vsAI.ai.used=new Set(); vsAI.ai.used.add(12);
    for(i=0;i<5;i++)for(j=0;j<5;j++){ if(whiteMask[i][j]){ vsAI.ai.vals[i][j]=String(nums[idx++]); } }
    renderAIBoard(false);
  }

  /* ------ 基準バー連携 ------ */
  function baselineFromDOM(){
    var el = document.getElementById('baseline');
    var n = el ? Number((el.textContent || '').trim()) : NaN;
    return Number.isFinite(n) ? n : 12;
  }
  function setSelectorToHuman(){
    usedNumbers = vsAI.usedHuman;
    baseline = vsAI.sharedBaseline;
    if(typeof renderBaselineBar==='function') renderBaselineBar();
    if (typeof baselineEl !== 'undefined' && baselineEl) baselineEl.textContent = String(baseline);
  }
  function forceBaselineDisplay(val){
    vsAI.sharedBaseline=val;
    usedNumbers=vsAI.usedHuman;
    baseline=val;
    if(typeof renderBaselineBar==='function') renderBaselineBar();
    if (typeof baselineEl !== 'undefined' && baselineEl) baselineEl.textContent = String(baseline);
    setTimeout(function(){
      if(typeof renderBaselineBar==='function') renderBaselineBar();
      if (typeof baselineEl !== 'undefined' && baselineEl) baselineEl.textContent = String(baseline);
    },60);
  }

  /* ------ 直近の人間の値（1含む） ------ */
  function getLastHumanPlacedValue(){
    if(!window.path || !window.path.length) return null;
    for (var idx=window.path.length-1; idx>=0; idx--){
      var p=window.path[idx], i=p[0], j=p[1];
      var cell=document.querySelector('#board .cell[data-i="'+i+'"][data-j="'+j+'"]');
      if(!cell) continue;
      var raw=(cell.dataset.value||cell.textContent||'').trim(); if(!raw) continue;
      var v=Number(raw); if(isFinite(v)) return v;
    }
    return null;
  }

  /* ------ 候補セル ------ */
  function snapHuman(){
    var cells=$('board').querySelectorAll('.cell');
    var chosen=[], path=(window.path? JSON.parse(JSON.stringify(window.path)) : []);
    for(var i=0;i<5;i++){ chosen[i]=[]; for(var j=0;j<5;j++) chosen[i][j]=false; }
    for(var k=0;k<cells.length;k++){ var c=cells[k]; chosen[+c.dataset.i][+c.dataset.j]=c.classList.contains('chosen'); }
    return {chosen:chosen, path:path};
  }
  function humanCandidates(){
    var s=snapHuman(), out=[], i,j,di,dj;
    function inB(i,j){ return i>=0&&i<5&&j>=0&&j<5; }
    function free(i,j){ return !s.chosen[i][j]; }
    if(s.path.length===0){ for(i=0;i<5;i++)for(j=0;j<5;j++) if(free(i,j)) out.push([i,j]); }
    else{
      var pi=s.path[s.path.length-1][0], pj=s.path[s.path.length-1][1];
      for(di=-1;di<=1;di++)for(dj=-1;dj<=1;dj++){
        if(!di&&!dj) continue; var ni=pi+di, nj=pj+dj;
        if(inB(ni,nj)&&free(ni,nj)) out.push([ni,nj]);
      }
    }
    return out;
  }
  function aiCandidates(){
    var s=vsAI.ai, out=[], i,j,di,dj;
    function inB(i,j){ return i>=0&&i<5&&j>=0&&j<5; }
    function free(i,j){ return !s.chosen[i][j]; }
    if(s.path.length===0){ for(i=0;i<5;i++)for(j=0;j<5;j++) if(free(i,j)) out.push([i,j]); }
    else{
      var pi=s.path[s.path.length-1][0], pj=s.path[s.path.length-1][1];
      for(di=-1;di<=1;di++)for(dj=-1;dj<=1;dj++){
        if(!di&&!dj) continue; var ni=pi+di, nj=pj+dj;
        if(inB(ni,nj)&&free(ni,nj)) out.push([ni,nj]);
      }
    }
    return out;
  }

  /* ------ AIの資源加算（連鎖対応） ------ */
  function aiAddRes(key, amt){
    var r=vsAI.ai.res; if(!amt) return;
    var beforeDip=r.dip, beforeArt=r.art;
    r[key]+=amt;
    if(key==='dip'){
      var got=Math.floor(r.dip/5)-Math.floor(beforeDip/5); if(got>0) aiAddRes('art',got);
    }
    if(key==='art'){
      var got2=Math.floor(r.art/4)-Math.floor(beforeArt/4); if(got2>0){ r.inv+=got2; }
    }
  }

  /* ====== 評価・先読み部 ====== */

  function _triFromResearchArr(arr){
    var total=0, run=0, prev=null;
    for(var i=0;i<12;i++){
      var v=(typeof arr[i]==='number')? arr[i] : null;
      if(v===null){ if(run>0){ total += run*(run+1)/2; run=0; prev=null; } continue; }
      if(prev!==null && v>prev){ run += 1; } else { if(run>0){ total += run*(run+1)/2; } run=1; }
      prev=v;
    }
    if(run>0) total += run*(run+1)/2;
    return total;
  }

  function _cloneAI(ai){
    var o={
      vals:[], chosen:[], path:[],
      res:{food:ai.res.food,sci:ai.res.sci,ind:ai.res.ind,art:ai.res.art,dip:ai.res.dip,inv:ai.res.inv},
      research:ai.research.slice(),
      frontierX:new Set(Array.from(ai.frontierX)),
      used:new Set(Array.from(ai.used)),
      tour: ai.tour ? ai.tour.slice() : []
    };
    for(var i=0;i<5;i++){
      o.vals[i]=[]; o.chosen[i]=[];
      for(var j=0;j<5;j++){ o.vals[i][j]=ai.vals[i][j]; o.chosen[i][j]=ai.chosen[i][j]; }
    }
    for(var k=0;k<ai.path.length;k++) o.path.push([ai.path[k][0], ai.path[k][1]]);
    return o;
  }

  // 本体と衝突しない：AI盤の未記入グレーを探す
  function _firstGreySpotForAI(state){
    var cells = aiBoard ? aiBoard.querySelectorAll('.cell') : null;
    if(!cells){
      for(var i=0;i<5;i++)for(var j=0;j<5;j++){
        if(!whiteMask[i][j] && !state.vals[i][j] && !state.chosen[i][j]) return [i,j];
      }
      return null;
    }
    for(var i=0;i<5;i++)for(var j=0;j<5;j++){
      for(var k=0;k<cells.length;k++){
        var c=cells[k];
        if(+c.dataset.i===i && +c.dataset.j===j){
          var isGrey=c.classList.contains('grey');
          if(isGrey && !state.vals[i][j] && !state.chosen[i][j]) return [i,j];
        }
      }
    }
    return null;
  }

  function _candsForState(state){
    var out=[], i,j,di,dj;
    function inB(i,j){ return i>=0&&i<5&&j>=0&&j<5; }
    function free(i,j){ return !state.chosen[i][j]; }
    if(state.path.length===0){ for(i=0;i<5;i++)for(j=0;j<5;j++) if(free(i,j)) out.push([i,j]); }
    else{
      var pi=state.path[state.path.length-1][0], pj=state.path[state.path.length-1][1];
      for(di=-1;di<=1;di++)for(dj=-1;dj<=1;dj++){
        if(!di&&!dj) continue; var ni=pi+di, nj=pj+dj;
        if(inB(ni,nj)&&free(ni,nj)) out.push([ni,nj]);
      }
    }
    return out;
  }

/* ------ 将来の到達セル数（詰み検出用） ------ */
// 未選択セル上を8近傍で flood-fill してサイズを数える（既に chosen のマスは壁）
function _floodCountFrom(state, si, sj, seen){
  var stack=[[si,sj]], cnt=0;
  while(stack.length){
    var p=stack.pop(), i=p[0], j=p[1];
    if(i<0||i>=5||j<0||j>=5) continue;
    if(seen[i][j]) continue;
    if(state.chosen[i][j]) continue;     // 選択済みは通れない
    seen[i][j]=true; cnt++;
    for(var di=-1; di<=1; di++) for(var dj=-1; dj<=1; dj++){
      if(!di && !dj) continue;
      stack.push([i+di, j+dj]);
    }
  }
  return cnt;
}

// 現在のヘッド（i,j）から「次に動ける成分」の合計サイズを返す
function _reachableFutureCount(state, i, j){
  var seen=[]; for(var a=0;a<5;a++){ seen[a]=[]; for(var b=0;b<5;b++) seen[a][b]=false; }
  var total=0;
  for(var di=-1; di<=1; di++) for(var dj=-1; dj<=1; dj++){
    if(!di && !dj) continue;
    var ni=i+di, nj=j+dj;
    if(ni<0||ni>=5||nj<0||nj>=5) continue;
    if(state.chosen[ni][nj]) continue;   // 未選択セルだけが“次の一歩”
    total += _floodCountFrom(state, ni, nj, seen);
  }
  return total; // これが将来辿れる残り面積
}


  function _eduGainFor(v){
    return {
      ind: (v<=5)?1 : (v<=10)?2 : (v<=15)?4 : (v<=20)?6 : 8,
      art: (v<=5)?2 : (v<=10)?1 : (v<=15)?2 : (v<=20)?2 : 3
    };
  }

// 重み（発明は無視、研究・文化を強調）
var _W = {
    inv: 0.0,  // 発明を無視
    art: 0.9, ind: 0.9, dip: 0.9, sci: 0.9, food: 0.4,
    tri: 1.2,  // 研究三角数を少し重視
    nat: -0.6, mobility: 0.2, stuck: -8.0
};


  // 1手適用＋スコア（発明無視・開拓展開力＋文化バランス強化）
function _applyAndScore(state, i, j, baselineNow){
  var turnBefore = state.path.length;
  var wasEmpty   = !state.vals[i][j];
  var before = {
    res: {food:state.res.food,sci:state.res.sci,ind:state.res.ind,art:state.res.art,dip:state.res.dip,inv:state.res.inv},
    tri: _triFromResearchArr(state.research),
    usedFront: state.frontierX.size
  };

  if(!state.vals[i][j]) state.vals[i][j]='1';
  state.chosen[i][j]=true; state.path.push([i,j]);
  var v = Number(state.vals[i][j])||1;
  var gt = v>baselineNow;

  // アクション
  if(gt && v%2===1){
    // 開拓
    var spot = _firstGreySpotForAI(state);
    if(spot && window.greyGain){
      var g = window.greyGain(spot[0], spot[1]);
      for(var key in g){ state.res[key]+=g[key]; }
      // ★展開力ボーナス：灰の隣にある未使用白マス数
      var neigh=0;
      for(var di=-1;di<=1;di++)for(var dj=-1;dj<=1;dj++){
        if(!di&&!dj) continue;
        var ni=spot[0]+di,nj=spot[1]+dj;
        if(ni>=0&&ni<5&&nj>=0&&nj<5 && whiteMask[ni][nj] && !state.chosen[ni][nj]) neigh++;
      }
      state.res.food += neigh*0; // 実リソースは変えずスコアで評価
      var bonus = neigh*4;       // 1隣接ごとに+4点
    }
  }else if(gt && v%2===0){
    // 研究
    var k=-1; for(var m=0;m<12;m++){ if(state.research[m]===null){ k=m; break; } }
    if(k>=0) state.research[k]=v;
  }else{
    // 教育（簡略化）
    state.res.ind += 1;
  }

  // 即時スコア
  var afterTri = _triFromResearchArr(state.research);
  var d = {
    inv: state.res.inv - before.res.inv,
    art: state.res.art - before.res.art,
    ind: state.res.ind - before.res.ind,
    dip: state.res.dip - before.res.dip,
    sci: state.res.sci - before.res.sci,
    food: state.res.food - before.res.food,
    tri: afterTri - before.tri,
    nat: (before.usedFront - state.frontierX.size)
  };
  var nextCands = _candsForState(state).length;
  var score = d.inv*_W.inv + d.art*_W.art + d.ind*_W.ind + d.dip*_W.dip + d.sci*_W.sci + d.food*_W.food + d.tri*_W.tri + d.nat*_W.nat
            + nextCands*_W.mobility + (nextCands===0? _W.stuck:0);

  // 文化バランス即時評価
  var beforeMin = Math.min(before.res.food, before.res.sci, before.res.ind);
  var afterMin  = Math.min(state.res.food, state.res.sci, state.res.ind);
  score += (afterMin - beforeMin) * 2.5;

  // 開拓展開力ボーナス加点
  if(typeof bonus!=='undefined') score += bonus;

  // 灰直踏みは減点
  if(wasEmpty && !whiteMask[i][j]) score -= (turnBefore===0?80:14);

  // ★詰み先読みペナルティ：この手の後に到達できる残り面積が不足していれば強く減点
  (function(){
    var future = _reachableFutureCount(state, i, j);           // この手の後、到達できる未選択セル総数
    var remain = 25 - state.path.length;                        // 残り手数（この手を含めたカウント後）
    var deficit = remain - future;                              // 未来の面積が足りていない分
    if (deficit > 0){
      // 1マス不足につき大きくマイナス（詰みに一直線の手を避ける）
      score -= 20 * deficit; // 35 → 20 で減少
    } else {
      // 余裕があるほど少しだけプラス（行動の余地を好む）
      var slack = Math.min(5, -deficit);
      score += 0.8 * slack; // 1.0 → 0.8 で減少
    }
  })();

  return {score: score, newBaseline: v};
}


  // 人間の次手の値を簡易予測
  function _predictHumanPickValue(B){
    var s=snapHuman();
    var bestV=null, bestS=-1e9;
    function valAt(i,j){
      var cell=document.querySelector('#board .cell[data-i="'+i+'"][data-j="'+j+'"]');
      if(!cell) return 1;
      var raw=(cell.dataset.value||cell.textContent||'').trim();
      var v=Number(raw); return isFinite(v)? v : 1;
    }
    var cand=[];
    if(s.path.length===0){ for(var i=0;i<5;i++)for(var j=0;j<5;j++) if(!s.chosen[i][j]) cand.push([i,j]); }
    else{
      var pi=s.path[s.path.length-1][0], pj=s.path[s.path.length-1][1];
      for(var di=-1;di<=1;di++)for(var dj=-1;dj<=1;dj++){
        if(!di&&!dj) continue; var ni=pi+di, nj=pj+dj;
        if(ni>=0&&ni<5&&nj>=0&&nj<5&&!s.chosen[ni][nj]) cand.push([ni,nj]);
      }
    }
    if(cand.length===0) return B;
    for(var k=0;k<cand.length;k++){
      var t=cand[k], v=valAt(t[0],t[1]), gt=v>B, sc=0;
      if(gt && v%2===0) sc+=60; else if(gt && v%2===1) sc+=40; else sc+=30;
      if(v>=20) sc+=2; if(v<=6) sc+=1;
      if(sc>bestS){ bestS=sc; bestV=v; }
    }
    return bestV==null? B : bestV;
  }

  // スネークツアー（8通り）
  function _baseSnake(){
    var a=[]; for(var i=0;i<5;i++){
      if(i%2===0){ for(var j=0;j<5;j++) a.push([i,j]); }
      else{ for(var j=4;j>=0;j--) a.push([i,j]); }
    }
    return a;
  }
  function _transform(p, rot, mir){
    var x=p[0], y=p[1];
    if(mir) y=4-y;
    for(var r=0;r<rot;r++){ var nx=y, ny=4-x; x=nx; y=ny; }
    return [x,y];
  }
  function _makeAllTours(){
    var base=_baseSnake(), tours=[];
    for(var rot=0;rot<4;rot++) for(var mir=0;mir<2;mir++){
      tours.push(base.map(function(p){ return _transform(p,rot,mir); }));
    }
    return tours;
  }
  function _rotateTour(tour, startIdx){
    var n=tour.length, out=[]; for(var k=0;k<n;k++) out.push(tour[(startIdx+k)%n]); return out;
  }
  function _isAdj(a,b){ var di=Math.abs(a[0]-b[0]), dj=Math.abs(a[1]-b[1]); return di<=1 && dj<=1 && !(di===0&&dj===0); }

  function _firstPlayableRotation(tour, state){
    if(state.path.length===0){
      for(var k=0;k<tour.length;k++){ var p=tour[k]; if(!state.chosen[p[0]][p[1]]) return _rotateTour(tour,k); }
      return tour;
    }else{
      var last=state.path[state.path.length-1];
      for(var k=0;k<tour.length;k++){
        var p=tour[k]; if(state.chosen[p[0]][p[1]]) continue;
        if(_isAdj(last,p)) return _rotateTour(tour,k);
      }
      return null;
    }
  }
  function _filterChosenFromFront(tour, state){
    return tour.filter(function(p){ return !state.chosen[p[0]][p[1]]; });
  }

  function _scoreTourFullFrom(baseState, tour, baselineStart){
    var sim=_cloneAI(baseState);
    var B=baselineStart, tot=0, disc=1.0, df=0.96, used=0;
    for(var idx=0; idx<tour.length && used<25; idx++){
      var p=tour[idx];
      if(sim.chosen[p[0]][p[1]]) continue;
      if(sim.path.length>0){
        var last=sim.path[sim.path.length-1];
        var di=Math.abs(last[0]-p[0]), dj=Math.abs(last[1]-p[1]);
        if(di>1 || dj>1 || (di===0 && dj===0)) break;
      }
      var r=_applyAndScore(sim, p[0], p[1], B);
      B = _predictHumanPickValue(r.newBaseline);
      tot += disc*r.score; disc*=df; used++;
    }
var remainAll = 25 - used;
if (remainAll > 0) tot -= 40 * remainAll;  // ← 1マス不足ごとに-40（強め）
    return tot;
  }

  function _pickBestTourFrom(baseState, baselineNow){
    var tours=_makeAllTours();
    var best=null, bestScore=-1e9;
    for(var t=0;t<tours.length;t++){
      var rot=_firstPlayableRotation(tours[t], baseState);
      if(!rot) continue;
      var filtered=_filterChosenFromFront(rot, baseState);
      var sc=_scoreTourFullFrom(baseState, filtered, baselineNow);
      if(sc>bestScore){ bestScore=sc; best=filtered; }
    }
    return best;
  }

  // AIの手選択
function aiPick(){
  var cand = aiCandidates(); if(!cand.length) return null;

  // 初手だけは白限定（灰直踏みを禁止）
  if (vsAI.ai.path.length === 0) {
    var whites = [];
    for (var c=0;c<cand.length;c++){
      var p=cand[c]; if(whiteMask[p[0]][p[1]]) whites.push(p);
    }
    if (whites.length) cand = whites;
  }

  var BV=vsAI.sharedBaseline;
  var best=null, bestScore=-1e9;

  for(var k=0;k<cand.length;k++){
    var t=cand[k], i=t[0], j=t[1];

    // 1手の即時利得
    var sim=_cloneAI(vsAI.ai);
    var r1=_applyAndScore(sim, i, j, BV);
    var B2=_predictHumanPickValue(r1.newBaseline);

    // 今の1手を適用した state から最適ツアーで継続期待
    var tour = _pickBestTourFrom(sim, B2) || [];
    var cont = _scoreTourFullFrom(sim, tour, B2);

    // 合成
    var total = r1.score + 0.65*cont;

    // ★ 開拓優先度を強化（開拓優先（初期数手）+ 四隅優先）
    if (vsAI.ai.path.length <= 3) { // 開拓優先（初期3手）
      if (i === 0 || i === 4 || j === 0 || j === 4) {  // 四隅や境界を優先
        total += 18; // 開拓優先 +18点
      }
    }

    // 開拓/研究戦術オーバーライド
    (function(){
      var isGrey = !whiteMask[i][j];
      var hasOddFrontierWhiteAdj = false;
      var hasEvenWhiteAdj = false;

      // 隣接に「白 & 値>基準 & 奇数（=即開拓）」/「白 & 値>基準 & 偶数（=即研究）」があるか判定
      for (var di=-1; di<=1; di++) for (var dj=-1; dj<=1; dj++){
        if (!di && !dj) continue;
        var ni=i+di, nj=j+dj;
        if (ni<0||ni>=5||nj<0||nj>=5) continue;
        if (!whiteMask[ni][nj]) continue;
        var vv = Number(vsAI.ai.vals[ni][nj] || '');
        if (!Number.isFinite(vv)) continue;
        if (vv > BV && (vv % 2 === 1)) hasOddFrontierWhiteAdj = true;
        if (vv > BV && (vv % 2 === 0)) hasEvenWhiteAdj      = true;
      }

      // 隣に>基準（奇数 or 偶数）があるのに「グレーへ」は強く抑制
      if (isGrey && (hasOddFrontierWhiteAdj || hasEvenWhiteAdj)) {
        total -= 22;   // ←調整幅（20〜26の範囲でOK）
      }

      // 今の候補自体が >基準奇数（=即開拓）なら押し上げる
      var vNow = Number(vsAI.ai.vals[i][j] || '1') || 1;
      if (!isGrey && vNow > BV && (vNow % 2 === 1)) total += 6;

      // 今の候補自体が >基準偶数（=即研究）も少し優遇（灰踏みを上回らせる）
      if (!isGrey && vNow > BV && (vNow % 2 === 0)) total += 3.5;
    })();

    // 軽いバイアス：基準超偶数（研究）は少し優遇
    var vNow = Number(vsAI.ai.vals[i][j] || '1') || 1;
    if(vNow>BV && vNow%2===0) total += 0;

    if(total>bestScore){ bestScore=total; best=t; }
  }
  return best;
}



    // 開拓番号の書き込み先：近場・可動域優先（開拓優先度を強化）
  function aiPlaceGrey(dev){
    if(!aiBoard) return;
    var cells=aiBoard.querySelectorAll('.cell');
    var cand=[];
    for(var k=0;k<cells.length;k++){
      var c=cells[k], i=+c.dataset.i, j=+c.dataset.j;
      if(c.classList.contains('grey') && !vsAI.ai.vals[i][j] && !vsAI.ai.chosen[i][j]){
        // 開拓すべきマスを優先
        if (i === 0 || i === 4 || j === 0 || j === 4) { // 四隅や境界マスを優先
          cand.push([i,j]);
        }
      }
    }
    if(!cand.length) return;

    var head = vsAI.ai.path.length ? vsAI.ai.path[vsAI.ai.path.length-1] : null;
    var best=cand[0], bestScore=-1e9;
    for(var t=0;t<cand.length;t++){
      var i=cand[t][0], j=cand[t][1];
      var dist = head ? Math.max(Math.abs(head[0]-i), Math.abs(head[1]-j)) : 0;
      var s = -dist*3; // 近いほど高評価
      if(i===2 && j===2) s += 1.5; // 中央灰は足場として少し優遇
      var nw=0; for(var di=-1;di<=1;di++)for(var dj=-1;dj<=1;dj++){
        if(!di&&!dj) continue; var ni=i+di,nj=j+dj;
        if(ni>=0&&ni<5&&nj>=0&&nj<5 && whiteMask[ni][nj] && !(vsAI.ai.chosen[ni]&&vsAI.ai.chosen[ni][nj])) nw++;
      }
      s += nw*0.8;
      if(s>bestScore){ bestScore=s; best=cand[t]; }
    }

    var bi=best[0], bj=best[1];
    vsAI.ai.vals[bi][bj]=String(dev);
    if(typeof window.greyGain==='function'){
      var g=window.greyGain(bi,bj); for(var key in g){ aiAddRes(key,g[key]); }
    }
  }


  function aiTurn(){
    if(!vsAI.enabled) return;
    if(isAIFull()) { vsAI.fallback=null; return; }

    var cand=aiCandidates();
    if(!cand.length){ vsAI.fallback=null; return; }

    var pick=aiPick(); if(!pick) { vsAI.fallback=null; return; }
    var i=pick[0], j=pick[1];
    if(!vsAI.ai.vals[i][j]) vsAI.ai.vals[i][j]='1';
    vsAI.ai.chosen[i][j]=true; vsAI.ai.path.push([i,j]);

    var val=Number(vsAI.ai.vals[i][j]), gt=val>vsAI.sharedBaseline;

    if(gt && val%2===1){
      var n, idx, p;
      for(n=0;n<frontierNumbers.length;n++){ if(!vsAI.ai.frontierX.has(frontierNumbers[n])){ p=frontierNumbers[n]; break; } }
      if(p!=null){ idx=frontierNumbers.indexOf(p); for(n=0;n<=idx;n++) vsAI.ai.frontierX.add(frontierNumbers[n]); aiPlaceGrey(p); }
    }else if(gt && val%2===0){
      var k=-1, m; for(m=0;m<12;m++){ if(vsAI.ai.research[m]===null){ k=m; break; } }
      if(k>=0){ vsAI.ai.research[k]=val; if(window.researchGain){ var gg=window.researchGain[k]; for(var key in gg){ aiAddRes(key,gg[key]); } } }
    }else{
      var eg=_eduGainFor(val);
      var willBulb = ((vsAI.ai.res.art % 4) + eg.art) >= 4;
      if(willBulb){ aiAddRes('art',eg.art); } else { aiAddRes('ind',eg.ind); }
    }

    // 共有基準をAIの選択値へ
    vsAI.sharedBaseline = val;
    vsAI.usedHuman.add(val);
    forceBaselineDisplay(val);
    renderAIBoard(true);
  }

  function runAISolo(){
    if(vsAI.fallback!=='AI') return;
    function tick(){
      if(vsAI.fallback!=='AI') return;
      if(isAIFull()) { vsAI.fallback=null; return; }
      var cand=aiCandidates();
      if(!cand.length){ vsAI.fallback=null; return; }
      aiTurn();
      setTimeout(tick,110);
    }
    setTimeout(tick,60);
  }

  /* ------ 人間→AI 手番制御 ------ */
  var histBox=$('historyList'); var prevHist=histBox?histBox.children.length:0;
  if(histBox){
    new MutationObserver(function(){
      var now=histBox.children.length;
      if(!vsAI.enabled){ prevHist=now; return; }
      if(now<=prevHist){ prevHist=now; return; }

      var lastVal=getLastHumanPlacedValue();
      if(lastVal!=null){
        vsAI.sharedBaseline=lastVal;
        vsAI.usedAI.add(lastVal);
        vsAI.usedHuman.add(lastVal);
        setSelectorToHuman();
      }
      var cand = humanCandidates();
      var humanFull = isHumanFull();
      if (humanFull) {
        if (!isAIFull()) { vsAI.fallback = 'AI'; runAISolo(); }
      } else if (cand.length === 0) {
        vsAI.fallback = 'AI';
        runAISolo();
      } else if (vsAI.fallback === null) {
        setTimeout(aiTurn, 120);
      }
      prevHist=now;
    }).observe(histBox,{childList:true});
  }

  /* ------ 2人対戦のスコア計算 ------ */
  function sciFromResearchArr(arr){ return _triFromResearchArr(arr); }
  function natFromFrontier(set){ var all=new Set(frontierNumbers); set.forEach(function(n){ all.delete(n); }); return all.size; }
  function comp2p(my, opp){
    var pts=0, k; var keys=['sci','ind','dip','art']; for(var t=0;t<keys.length;t++){ k=keys[t]; if(my[k]>=opp[k]) pts++; }
    return pts;
  }
  function _num(id){
    var el = document.getElementById(id);
    if(!el) return 0;
    var t = (el.textContent || el.innerText || '').replace(/[^\d\-]/g,'');
    var n = parseInt(t,10);
    return isNaN(n) ? 0 : n;
  }
  function _readMyResFromDOM(){
    return { food:_num('rFood'), sci:_num('rSci'), ind:_num('rInd'), art:_num('rArt'), dip:_num('rDip'), inv:_num('rInv') };
  }
  function vsaiScore(){
    var out=$('scoreOut'); if(!out) return;
    var mine=_readMyResFromDOM();
    var mySciEnd = (typeof window.calcScienceFromResearch==='function')? window.calcScienceFromResearch() : 0;
    var myCompBase = { sci: mine.sci + mySciEnd, ind: mine.ind, dip: mine.dip, art: mine.art };
    var myInv = mine.inv;
    var myCultureMin = Math.min(mine.food, myCompBase.sci, myCompBase.ind);
    var myNat = (typeof window.naturalScore==='function') ? window.naturalScore() : 0;

    var aiSciEnd = sciFromResearchArr(vsAI.ai.research);
    var aiCompBase = { sci: vsAI.ai.res.sci + aiSciEnd, ind:vsAI.ai.res.ind, dip:vsAI.ai.res.dip, art:vsAI.ai.res.art };
    var aiInv = vsAI.ai.res.inv;
    var aiNat = natFromFrontier(vsAI.ai.frontierX);
    var aiCultureMin = Math.min(vsAI.ai.res.food, aiCompBase.sci, aiCompBase.ind);

    var myComp = comp2p(myCompBase, aiCompBase);
    var aiComp = comp2p(aiCompBase, myCompBase);

    var myTotal = myInv + myCultureMin + myComp + myNat;
    var aiTotal = aiInv + aiCultureMin + aiComp + aiNat;
    var myWin = myTotal>aiTotal, aiWin=aiTotal>myTotal;

    var html = '';
    html += '<div class="vsai-score">';
    html += '<h3>2人対戦の得点比較</h3>';
    html += '<table class="tbl mono"><tr><th></th><th>あなた</th><th>AI</th></tr>';
    html += '<tr><th>🧪 科学（本体+研究）</th><td>'+mine.sci+' + '+mySciEnd+' = <b>'+myCompBase.sci+'</b></td><td>'+vsAI.ai.res.sci+' + '+aiSciEnd+' = <b>'+aiCompBase.sci+'</b></td></tr>';
    html += '<tr><th>⚙ 産業</th><td><b>'+myCompBase.ind+'</b></td><td><b>'+aiCompBase.ind+'</b></td></tr>';
    html += '<tr><th>👍 外交</th><td><b>'+myCompBase.dip+'</b></td><td><b>'+aiCompBase.dip+'</b></td></tr>';
    html += '<tr><th>🖋 芸術</th><td><b>'+myCompBase.art+'</b></td><td><b>'+aiCompBase.art+'</b></td></tr>';
    html += '<tr><th>🍞 文化min 用</th><td>min('+mine.food+','+myCompBase.sci+','+myCompBase.ind+') = <b>'+myCultureMin+'</b></td><td>min('+vsAI.ai.res.food+','+aiCompBase.sci+','+aiCompBase.ind+') = <b>'+aiCultureMin+'</b></td></tr>';
    html += '</table>';

    html += '<table class="tbl mono" style="margin-top:10px;"><tr><th>項目</th><th>あなた</th><th>AI</th></tr>';
    html += '<tr><th>💡 発明（未使用）</th><td>'+myInv+'</td><td>'+aiInv+'</td></tr>';
    html += '<tr><th>文化（min）</th><td>'+myCultureMin+'</td><td>'+aiCultureMin+'</td></tr>';
    html += '<tr><th>競争（2人・最大4）</th><td>'+myComp+'</td><td>'+aiComp+'</td></tr>';
    html += '<tr><th>自然（未使用の開拓番号）</th><td>'+myNat+'</td><td>'+aiNat+'</td></tr>';
    html += '<tr><th>合計</th><td><b>'+myTotal+'</b>'+ (myWin?' 🏆':'') +'</td><td><b>'+aiTotal+'</b>'+ (aiWin?' 🏆':'') +'</td></tr>';
    html += '</table>';
    html += '<div class="small" style="margin-top:6px;">同点は引き分け。競争は 🧪⚙👍🖋 の4項目で相手以上なら各1点（最大4点）。</div>';
    if(myWin) html += '<div class="score-banner" style="margin-top:8px;">🎉 あなたの勝ち！ 合計 <b>'+myTotal+'</b> 対 <b>'+aiTotal+'</b></div>';
    else if(aiWin) html += '<div class="score-banner" style="margin-top:8px;">🤖 AIの勝ち… 合計 <b>'+aiTotal+'</b> 対 <b>'+myTotal+'</b></div>';
    else html += '<div class="score-banner" style="margin-top:8px;">🔔 引き分け！ どちらも <b>'+myTotal+'</b></div>';
    html += '</div>';

    out.innerHTML = html;
  }

  /* ------ 得点ボタンをフック ------ */
  function hookScoreButton(){
    var btn=$('scoreBtn'); if(!btn) return;
    var orig=window.score || function(){};
    btn.onclick=function(e){
      e.preventDefault();
      if(vsAI.enabled){ vsaiScore(); }
      else{ orig(); }
    };
  }

/* ------ 全面リセットをフック（本体＋AIも初期化） ------ */
function hookResetButton(){
  var btn = $('resetAll'); if(!btn) return;

  // 本体のリセット処理（resetAll or btn.onclick）を退避
  var orig = btn.onclick || (typeof window.resetAll === 'function' ? window.resetAll : function(){});

  btn.onclick = function(e){
    e.preventDefault();

    // 1) 先に本体のリセットを実行（盤面・研究・基準値12・使用状況12などを初期化）
    orig.call(btn, e);

    // 2) AI側の共有状態も初期化（人・AIとも 12 のみ）
    if (vsAI) {
      vsAI.sharedBaseline = 12;
      vsAI.usedHuman = new Set([12]);
      vsAI.usedAI    = new Set([12]);
      vsAI.fallback = null;
    }

    // 3) 盤面再構築後にAI盤を描き直し＆セレクター表示を人間側に同期
    setTimeout(function(){
      if (vsAI && vsAI.enabled) {
        buildAIBoardFromMask();   // AI盤の vals/chosen/path/res をまっさらに
        setSelectorToHuman();     // usedNumbers/baseline の表示を12に
        hookScoreButton();        // 念のため再フック（安全策）
        hookResetButton();        // リセットボタンも再フック
      }
    }, 0);
  };
}

  /* ------ モード切替 ------ */
  modeSel.addEventListener('change', function(){
    vsAI.enabled = (modeSel.value==='vsai');
    if(vsAI.enabled){
      ensureAIPanel();
      vsAI.sharedBaseline = baselineFromDOM();
      var currentUsed = (typeof usedNumbers!=='undefined' && usedNumbers instanceof Set) ? usedNumbers : new Set();
      vsAI.usedHuman = new Set(currentUsed);
      vsAI.usedAI    = new Set(currentUsed);
      vsAI.fallback=null;
      buildAIBoardFromMask();
      setTimeout(function(){
        setSelectorToHuman();
        hookScoreButton();
        hookResetButton();      // ★追加
      },50);
    }else{
      removeAIPanel();
      if(typeof usedNumbers==='undefined') usedNumbers=new Set();
      if(typeof renderBaselineBar==='function'){ renderBaselineBar(); }
      hookScoreButton();
    }
  });

  /* ------ vsAI時の基準値更新を上書き（交互共有） ------ */
  (function(){
    var origUpdate = window.updateBaseline;
    window.updateBaseline = function(lastPickedVal){
      if (typeof lastPickedVal !== 'number' || !isFinite(lastPickedVal)) {
        return origUpdate ? origUpdate(lastPickedVal) : undefined;
      }
      if(vsAI && vsAI.enabled && vsAI.fallback===null){
        vsAI.sharedBaseline = lastPickedVal;
        if(vsAI.usedHuman) vsAI.usedHuman.add(lastPickedVal);
        if(vsAI.usedAI)    vsAI.usedAI.add(lastPickedVal);
        baseline = lastPickedVal;
        usedNumbers = vsAI.usedHuman;
        if(typeof renderBaselineBar==='function') renderBaselineBar();
        if (typeof baselineEl !== 'undefined' && baselineEl) baselineEl.textContent = String(baseline);
        return;
      }
      return origUpdate ? origUpdate(lastPickedVal) : undefined;
    };

    function setSelectorToSolo(){
      try{
        var uni = new Set();
        if(vsAI && vsAI.usedHuman) vsAI.usedHuman.forEach(function(x){ uni.add(x); });
        if(vsAI && vsAI.usedAI)    vsAI.usedAI.forEach(function(x){ uni.add(x); });
        usedNumbers = uni;
        if(typeof renderBaselineBar==='function') renderBaselineBar();
      }catch(e){}
    }

    setInterval(function(){
      if(!vsAI || !vsAI.enabled) return;
      if(vsAI.fallback==='HUMAN'){ setSelectorToSolo(); }
      else if(vsAI.fallback===null){ setSelectorToHuman && setSelectorToHuman(); }
    }, 200);
  })();

  /* ------ 起動時の初期化 ------ */
  setTimeout(function(){
    vsAI.sharedBaseline = baselineFromDOM();
    setSelectorToHuman();
    hookScoreButton();
    hookResetButton();
  },200);

})();
