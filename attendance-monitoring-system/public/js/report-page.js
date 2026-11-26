import { createPdfPreview } from './pdf-preview.js';
export async function renderReports(ctx){
  const {page,api,send,current,heading,esc}=ctx;
  const {events}=await api('/api/admin/events');if(!current())return;
  page.innerHTML=heading('Attendance reports','Generate an export, review its matching PDF preview, then download your preferred format.')+`<section class="workspace-card"><form id="report-form" class="management-form"><label class="admin-field">EVENT<select name="event_id" required><option value="">Choose event</option>${events.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select></label><label class="admin-field">DOWNLOAD FORMAT<select name="format"><option value="csv">CSV</option><option value="xlsx">Excel</option><option value="pdf">PDF</option><option value="docx">DOCX</option></select></label><button class="report-button" type="submit">Generate & preview report →</button></form><p id="report-state" role="status"></p><div class="report-links"><a id="report-preview-link" class="secondary-button privacy-link" target="_blank" rel="noopener" hidden>Open preview in a new tab ↗</a><a id="report-link" class="download-link" target="_blank" rel="noopener" hidden>Download report</a><button id="refresh-report-links" class="small-action" hidden>Refresh expired links</button></div></section><section id="report-preview" class="workspace-card" hidden><h2>Report preview</h2><p class="muted">The preview contains the same approved attendance used for this export. Use the page controls below to inspect it, or open the PDF in a new tab.</p><div data-pdf-preview></div></section>`;
  const form=page.querySelector('#report-form'),status=page.querySelector('#report-state'),download=page.querySelector('#report-link'),previewLink=page.querySelector('#report-preview-link'),preview=page.querySelector('#report-preview'),refresh=page.querySelector('#refresh-report-links');let jobUrl=null;
  const pdfPreview=createPdfPreview(preview.querySelector('[data-pdf-preview]'),current);
  ctx.onCleanup?.(()=>pdfPreview.clear());
  function show(job){
    download.href=job.download_url;download.hidden=false;refresh.hidden=false;
    preview.hidden=!job.preview_url;previewLink.hidden=!job.preview_url;
    if(job.preview_url){previewLink.href=job.preview_url;void pdfPreview.load(job.preview_url);}
    status.textContent=`Ready · ${job.record_count} approved check-ins. Preview and download links expire in 10 minutes.`;
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();const input=Object.fromEntries(new FormData(form)),button=form.querySelector('button');button.disabled=true;form.querySelectorAll('select').forEach(s=>s.disabled=true);download.hidden=true;previewLink.hidden=true;preview.hidden=true;pdfPreview.clear();refresh.hidden=true;jobUrl=null;
    try{
      let job=await send('/api/admin/reports',input);jobUrl=job.status_url;status.textContent='Report queued…';
      for(let attempt=0;attempt<300;attempt++){
        await new Promise(resolve=>setTimeout(resolve,2000));if(!current())return;job=await api(jobUrl);
        if(job.status==='failed')throw new Error(job.error);
        if(job.status==='completed'){show(job);break;}
        status.textContent=job.status==='queued'?'Report queued…':'Generating report and preview…';
        if(attempt===299)throw new Error('Report is still processing. Job ID: '+job.job_id);
      }
    }catch(e){if(current())status.textContent=e.message;}finally{if(current()){button.disabled=false;form.querySelectorAll('select').forEach(s=>s.disabled=false);}}
  });
  refresh.addEventListener('click',async()=>{if(!jobUrl)return;refresh.disabled=true;try{const job=await api(jobUrl);if(current())show(job);}catch(e){if(current())status.textContent=e.message;}finally{if(current())refresh.disabled=false;}});
}
