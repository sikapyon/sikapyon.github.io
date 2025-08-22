/* mmc-vsai-extension.js — ES5安全版（対AI＋AI観戦ボード） */
(function(){
  function $(id){ return document.getElementById(id); }
  var modeSel = $('mode');
  if(!modeSel){ console.warn('[vsAI] #mode が見つかりません。'); return; }

  // モード追加
  (function(){
    var has = false, i;
    for(i=0;i<modeSel.options.length;i++){ if(modeSel.options[i].value==='vsai'){ has=true; break; } }
    if(!has){
      var opt = document.createElement('option');
      opt.value='vsai'; opt.textContent='対AI（ふつう）';
      modeSel.appendChild(opt);
    }
  })();

  // 最小CSS
  (function(){
    var css = ''
      + '.vsai-dual{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap;}'
      + '.vsai-dual .boardWrap{flex:0 0 auto;}'
      + '.aiWrap .cell{pointer-events:none}'
      + '.aiWrap .aiTag{position:absolute;top:-22px;left:0;font-weight:600;color:#667}'
      + '@media (max-width:900px){ .vsai-dual{gap:14px;} }';
    var st=document.createElement('style'); st.type='text/css';
    if(st.styleSheet){ st.styleSheet.cssText=css; } else { st.appendChild(document.createTextNode(css)); }
    document.head.appendChild(st);
  })();

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
      frontierX:new Set(), used:(function(){ var s=new Set(); s.add(12); return s; })()
    }
  };

  var dualHost=null, origBoardWrap=null, aiWrap=null, aiBoard=null, aiLines=null, whiteMask=null;

  function ensureAIPanel(){
    if(dualHost) return;
    var mainCard = $('board') && $('board').closest ? $('board').closest('.card') : $('board').parentElement;
    origBoardWrap = $('board').parentElement;
    dualHost = document.createElement('div'); dualHost.className='vsai-dual';
    mainCard.insertBefore(dualHost, origBoardWrap);
    dualHost.appendChild(origBoardWrap);

    aiWrap = document.createElement('div'); aiWrap.className='boardWrap aiWrap';
    aiBoard = document.createElement('div'); aiBoard.className='grid'; aiBoard.id='aiBoardView';
    aiLines = document.createElementNS('http://www.w3.org/2000/svg','svg'); aiLines.setAttribute('class','lines');
    var tag=document.createElement('div'); tag.className='aiTag'; tag.textContent='AI';
    aiWrap.appendChild(aiBoard); aiWrap.appendChild(aiLines); aiWrap.appendChild(tag);
    dualHost.appendChild(aiWrap);

    var humanCells = $('board').querySelectorAll('.cell');
    var i,j;
    whiteMask=[]; for(i=0;i<5;i++){ whiteMask[i]=[]; for(j=0;j<5;j++) whiteMask[i][j]=false; }
    aiBoard.innerHTML='';
    for(var k=0;k<humanCells.length;k++){
      var c=humanCells[k]; i=+c.dataset.i; j=+c.dataset.j;
      var isWhite = c.classList.contains('white'); whiteMask[i][j]=isWhite;
      var d=document.createElement('div');
      d.className='cell ' + (isWhite?'white':'grey');
      d.dataset.i=i; d.dataset.j=j; d.dataset.value='';
      aiBoard.appendChild(d);
    }
    fitAiSVG(false);
  }
  function removeAIPanel(){
    if(!dualHost) return;
    var parent = dualHost.parentElement;
    parent.insertBefore(origBoardWrap, dualHost);
    dualHost.parentElement.removeChild(dualHost);
    dualHost=null; aiWrap=null; aiBoard=null; aiLines=null;
  }

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
      var a=center(path[k-1]), b=center(path[k]);
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
    var cells = aiBoard.querySelectorAll('.cell');
    for(var k=0;k<cells.length;k++){
      var c=cells[k], i=+c.dataset.i, j=+c.dataset.j;
      var v = (vsAI.ai.vals[i]&&vsAI.ai.vals[i][j])? vsAI.ai.vals[i][j] : '';
      c.dataset.value=v; c.textContent=v;
      var chosen = (vsAI.ai.chosen[i]&&vsAI.ai.chosen[i][j])? true:false;
      if(chosen) c.classList.add('chosen'); else c.classList.remove('chosen');
    }
    fitAiSVG(animate);
  }

  function shuffle(a){ for(var k=a.length-1;k>0;k--){ var j=Math.floor(Math.random()*(k+1)); var t=a[k]; a[k]=a[j]; a[j]=t; } return a; }
  function buildAIBoardFromMask(){
    if(!whiteMask) ensureAIPanel();
    var nums=[]; for(var n=5;n<=20;n++) nums.push(n); shuffle(nums); var idx=0;
    var i,j;
    vsAI.ai.vals=[]; vsAI.ai.chosen=[]; vsAI.ai.path=[];
    for(i=0;i<5;i++){ vsAI.ai.vals[i]=[]; vsAI.ai.chosen[i]=[]; for(j=0;j<5;j++){ vsAI.ai.vals[i][j]=''; vsAI.ai.chosen[i][j]=false; } }
    vsAI.ai.res={food:0,sci:0,ind:0,art:0,dip:0,inv:0};
    vsAI.ai.research=[]; for(i=0;i<12;i++) vsAI.ai.research[i]=null;
    vsAI.ai.frontierX=new Set(); vsAI.ai.used=new Set(); vsAI.ai.used.add(12);
    for(i=0;i<5;i++)for(j=0;j<5;j++){ if(whiteMask[i][j]){ vsAI.ai.vals[i][j]=String(nums[idx++]); } }
    renderAIBoard(false);
  }

  function baselineFromDOM(){
    var bar = $('baselineBar'); if(!bar) return 12;
    var m = bar.textContent.match(/基準[:：]\s*(\d+)/); return m? Number(m[1]) : 12;
  }
  function setSelectorToHuman(){
    if(window.usedNumbers) window.usedNumbers = vsAI.usedHuman;
    if(typeof window.renderBaselineBar==='function'){
      window.baseline = vsAI.sharedBaseline;
      window.renderBaselineBar();
    }
  }

// 対AIの基準表示を“最後に置いた値”で強制反映（元UIの再描画に勝つ）
function forceBaselineDisplay(val){
  vsAI.sharedBaseline = val;
  if(window.usedNumbers) window.usedNumbers = vsAI.usedHuman;   // 表示は常に人間側
  window.baseline = val;
  if (typeof window.renderBaselineBar === 'function') window.renderBaselineBar();

  // 元コード側の遅延再描画に上書きされる場合に備え、もう一度押さえる
  setTimeout(function(){
    window.baseline = val;
    if (typeof window.renderBaselineBar === 'function') window.renderBaselineBar();
  }, 60);
}


  function snapHuman(){
    var cells = $('board').querySelectorAll('.cell');
    var chosen=[], path=(window.path? JSON.parse(JSON.stringify(window.path)) : []);
    for(var i=0;i<5;i++){ chosen[i]=[]; for(var j=0;j<5;j++) chosen[i][j]=false; }
    for(var k=0;k<cells.length;k++){
      var c=cells[k]; chosen[+c.dataset.i][+c.dataset.j]=c.classList.contains('chosen');
    }
    return {chosen:chosen, path:path};
  }

// 盤面DOMから「直近に置いた“実際の数字(1以外)”」を取得
function getLastHumanPlacedValue(){
  if(!window.path || !window.path.length) return null;
  // 末尾から遡って「1 以外」の値を持つセルを探す
  for (var idx = window.path.length - 1; idx >= 0; idx--) {
    var p = window.path[idx]; // [i, j]
    var i = p[0], j = p[1];
    var cell = document.querySelector('#board .cell[data-i="'+i+'"][data-j="'+j+'"]');
    if(!cell) continue;
    // 空はスキップ
    var raw = (cell.dataset.value || cell.textContent || '').trim();
    if(!raw) continue;
    var v = Number(raw);
    if (!isFinite(v)) continue;

    // “1” は教育用に後から書いたマスなのでスキップし、1 以外を返す
    if (v !== 1) return v;
    // v===1 の場合は、さらに一つ手前へ（そのひとつ前が本当に選んだ数字）
  }
  return null; // 見つからなければ null
}


  function humanCandidates(){
    var s=snapHuman(), out=[];
    function inB(i,j){ return i>=0&&i<5&&j>=0&&j<5; }
    function free(i,j){ return !s.chosen[i][j]; }
    var i,j,di,dj;
    if(s.path.length===0){ for(i=0;i<5;i++)for(j=0;j<5;j++) if(free(i,j)) out.push([i,j]); }
    else{
      var pi=s.path[s.path.length-1][0], pj=s.path[s.path.length-1][1];
      for(di=-1;di<=1;di++)for(dj=-1;dj<=1;dj++){
        if(!di&&!dj) continue;
        var ni=pi+di, nj=pj+dj;
        if(inB(ni,nj)&&free(ni,nj)) out.push([ni,nj]);
      }
    }
    return out;
  }

  function aiCandidates(){
    var s=vsAI.ai, out=[];
    function inB(i,j){ return i>=0&&i<5&&j>=0&&j<5; }
    function free(i,j){ return !s.chosen[i][j]; }
    var i,j,di,dj;
    if(s.path.length===0){ for(i=0;i<5;i++)for(j=0;j<5;j++) if(free(i,j)) out.push([i,j]); }
    else{
      var pi=s.path[s.path.length-1][0], pj=s.path[s.path.length-1][1];
      for(di=-1;di<=1;di++)for(dj=-1;dj<=1;dj++){
        if(!di&&!dj) continue;
        var ni=pi+di, nj=pj+dj;
        if(inB(ni,nj)&&free(ni,nj)) out.push([ni,nj]); // ← 安全に修正
      }
    }
    return out;
  }

  function aiPick(){
    var cand=aiCandidates(); if(!cand.length) return null;
    var BV = vsAI.sharedBaseline, best=null, score=-1e9, t, v, s, gt;
    for(var k=0;k<cand.length;k++){
      t=cand[k]; v=Number(vsAI.ai.vals[t[0]][t[1]]||'1')||1; s=0; gt=v>BV;
      if(gt && v%2===0) s+=60; else if(gt && v%2===1) s+=40; else s+=30;
      if(v>=20) s+=2; if(v<=6) s+=1;
      if(s>score){ score=s; best=t; }
    }
    return best;
  }

  function aiPlaceGrey(dev){
    var cells = aiBoard.querySelectorAll('.cell');
    var i,j,k;
    for(i=0;i<5;i++)for(j=0;j<5;j++){
      for(k=0;k<cells.length;k++){
        var domCell=cells[k];
        if(+domCell.dataset.i===i && +domCell.dataset.j===j){
          var isGrey = domCell.classList.contains('grey');
          if(isGrey && !vsAI.ai.vals[i][j] && !vsAI.ai.chosen[i][j]){
            vsAI.ai.vals[i][j]=String(dev); return;
          }
        }
      }
    }
  }

  function advanceSolo(lastVal, usedSet){
    var base=vsAI.sharedBaseline, dir=(lastVal>base)?1:-1;
    var cand=lastVal+dir;
    while(cand>=1 && cand<=25 && usedSet.has(cand)) cand+=dir;
    if(cand<1||cand>25){
      cand=lastVal-dir;
      while(cand>=1&&cand<=25&&usedSet.has(cand)) cand-=dir;
    }
    if(cand>=1 && cand<=25) vsAI.sharedBaseline=cand;
  }

  function aiTurn(){
    if(!vsAI.enabled || vsAI.fallback==='AI') return;
    var cand = aiCandidates();
    if(!cand.length){ vsAI.fallback='HUMAN'; return; }
    var pick=aiPick(), i=pick[0], j=pick[1];
    if(!vsAI.ai.vals[i][j]) vsAI.ai.vals[i][j]='1';
    vsAI.ai.chosen[i][j]=true; vsAI.ai.path.push([i,j]);
    var val=Number(vsAI.ai.vals[i][j]), gt = val>vsAI.sharedBaseline;
    if(gt && val%2===1){
      var n,idx,p;
      for(n=0;n<frontierNumbers.length;n++){ if(!vsAI.ai.frontierX.has(frontierNumbers[n])){ p=frontierNumbers[n]; break; } }
      if(p!=null){
        idx=frontierNumbers.indexOf(p);
        for(n=0;n<=idx;n++) vsAI.ai.frontierX.add(frontierNumbers[n]);
        aiPlaceGrey(p);
      }
    }else if(gt && val%2===0){
      var k = -1;
      for(n=0;n<12;n++){ if(vsAI.ai.research[n]===null){ k=n; break; } }
      if(k>=0) vsAI.ai.research[k]=val;
    }
    vsAI.sharedBaseline = val;
vsAI.usedHuman.add(val);
// setSelectorToHuman();
forceBaselineDisplay(val);   // ← ここに変更
renderAIBoard(true);

  }

  function runAISolo(){
    if(vsAI.fallback!=='AI') return;
    var step=0;
    function tick(){
      if(vsAI.fallback!=='AI') return;
      if(step++>40){ vsAI.fallback=null; return; }
      var cand = aiCandidates();
      if(!cand.length){
        var any=[], i,j;
        for(i=0;i<5;i++)for(j=0;j<5;j++) if(!vsAI.ai.chosen[i][j]) any.push([i,j]);
        if(!any.length){ vsAI.fallback=null; return; }
        var t=any[0]; i=t[0]; j=t[1];
        if(!vsAI.ai.vals[i][j]) vsAI.ai.vals[i][j]='1';
        vsAI.ai.chosen[i][j]=true; vsAI.ai.path.push([i,j]);
        advanceSolo(1, vsAI.usedAI);
        setSelectorToHuman();
        renderAIBoard(true);
      }else{
        aiTurn();
      }
      setTimeout(tick, 110);
    }
    setTimeout(tick, 50);
  }

  // 履歴＝人間の手確定 → AI処理
var histBox = $('historyList');
var prevHist = histBox ? histBox.children.length : 0;
if(histBox){
  new MutationObserver(function(){
    var now = histBox.children.length;
    if(!vsAI.enabled){ prevHist=now; return; }
    if(now<=prevHist){ prevHist=now; return; }

    // ★置いた値を基準にする（ソロ値ではなく）
var lastVal = getLastHumanPlacedValue();
if(lastVal != null){
  // ↓ここを置き換え
  // vsAI.sharedBaseline = lastVal;
  // vsAI.usedAI.add(lastVal);
  // setSelectorToHuman();
  vsAI.usedAI.add(lastVal);
  forceBaselineDisplay(lastVal);   // ← これに置き換え
}


    // 詰み判定 → AIの動き
    var cand = humanCandidates();
    if(cand.length===0){ vsAI.fallback='AI'; runAISolo(); }
    else if(vsAI.fallback===null){ setTimeout(aiTurn, 120); }

    prevHist = now;
  }).observe(histBox, {childList:true});
}

  // モード切替
  modeSel.addEventListener('change', function(){
    vsAI.enabled = (modeSel.value==='vsai');
    if(vsAI.enabled){
      ensureAIPanel();
      vsAI.sharedBaseline = 12;
      vsAI.usedHuman = new Set(); vsAI.usedHuman.add(12);
      vsAI.usedAI    = new Set(); vsAI.usedAI.add(12);
      vsAI.fallback  = null;
      buildAIBoardFromMask();
      setTimeout(function(){
        vsAI.sharedBaseline = baselineFromDOM();
        setSelectorToHuman();
      }, 50);
    }else{
      removeAIPanel();
      if(!window.usedNumbers) window.usedNumbers = new Set();
      if(typeof window.renderBaselineBar==='function'){ window.renderBaselineBar(); }
    }
  });

  setTimeout(function(){ vsAI.sharedBaseline = baselineFromDOM(); setSelectorToHuman(); }, 200);
})();
