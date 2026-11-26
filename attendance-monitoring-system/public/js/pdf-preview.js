import { createPagination } from './pagination.js';
let library;
export function createPdfPreview(container,current){
  container.innerHTML='<p class="muted" data-pdf-status role="status"></p><label class="admin-field">PREVIEW ZOOM<select data-pdf-zoom><option value="fit">Fit page width</option><option value="100">100%</option><option value="150">150%</option><option value="200">200%</option></select></label><nav class="review-pagination" data-pdf-pages></nav><div class="pdf-canvas-wrap"><canvas aria-label="Report preview page" role="img"></canvas></div><details><summary>Read page text</summary><div class="pdf-page-text"></div></details>';
  const canvas=container.querySelector('canvas'),status=container.querySelector('[data-pdf-status]'),text=container.querySelector('.pdf-page-text');let document=null,loading=null,rendering=null,revision=0,page=1;
  const pagination=createPagination(container.querySelector('[data-pdf-pages]'),selected=>{page=selected;void render();});
  const zoom=container.querySelector('[data-pdf-zoom]');zoom.addEventListener('change',()=>void render());
  async function render(){
    if(!document||!current())return;const request=++revision;rendering?.cancel();pagination.busy();status.textContent='Rendering preview…';
    try{
      const sheet=await document.getPage(page);if(request!==revision||!current())return;
      const base=sheet.getViewport({scale:1}),width=Math.max(200,Math.min(1000,container.clientWidth-2)),viewport=sheet.getViewport({scale:zoom.value==='fit'?width/base.width:Number(zoom.value)/100}),ratio=Math.min(window.devicePixelRatio||1,2);
      canvas.width=Math.floor(viewport.width*ratio);canvas.height=Math.floor(viewport.height*ratio);canvas.style.width=zoom.value==='fit'?'100%':viewport.width+'px';canvas.style.height='auto';
      rendering=sheet.render({canvasContext:canvas.getContext('2d'),viewport,transform:ratio===1?null:[ratio,0,0,ratio,0,0]});await rendering.promise;if(request!==revision||!current())return;
      const content=await sheet.getTextContent();if(request!==revision||!current())return;text.textContent=content.items.map(item=>item.str||'').join(' ');canvas.setAttribute('aria-label',`Report preview page ${page} of ${document.numPages}. Use Read page text for accessible content.`);status.textContent='Preview ready';pagination.update(page,document.numPages);
    }catch(e){if(request===revision&&current()&&e.name!=='RenderingCancelledException')status.textContent='Unable to display this preview. Refresh the links or open the PDF in a new tab.';}
  }
  return {
    clear(){revision++;rendering?.cancel();void loading?.destroy();loading=null;document=null;canvas.width=0;canvas.height=0;text.textContent='';status.textContent='';},
    async load(url){
      revision++;const request=revision;rendering?.cancel();void loading?.destroy();document=null;text.textContent='';status.textContent='Loading PDF preview…';pagination.busy();
      try{
        library??=import('/vendor/pdfjs/pdf.mjs');const pdf=await library;if(!current()||request!==revision)return;pdf.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.mjs';
        loading=pdf.getDocument({url,isEvalSupported:false,disableAutoFetch:true});const loaded=await loading.promise;if(!current()||request!==revision){void loaded.destroy();return;}document=loaded;page=1;await render();
      }catch(e){if(current()&&request===revision)status.textContent='Unable to load the PDF preview. Refresh the links or open the PDF in a new tab.';}
    },
  };
}
