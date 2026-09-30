import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BrowserWindow, session } from 'electron';
import { installSchoolDownloads } from '../dist/electron/browser/native-downloads.js';
import { HomeworkFiles } from '../dist/electron/files/homework-files.js';
import { schoolPdf } from './fixtures/school-pdf.mjs';

export async function run(root) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({path:request.url, method:request.method});
    if (request.url === '/') {
      response.setHeader('content-type', 'text/html');
      response.end('<form action="/file" method="post"><button>Download</button></form><a href="/pdf">Download PDF</a>');
    } else if (request.url === '/pdf') {
      response.setHeader('content-type', 'application/pdf');
      response.setHeader('content-disposition', 'attachment; filename="syllabus.pdf"');
      response.end(schoolPdf());
    } else {
      response.setHeader('content-type', 'application/octet-stream');
      response.setHeader('content-disposition', 'attachment; filename="notes.txt"');
      response.end('original POST download');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const school = session.fromPartition('native-download-routing');
  const window = new BrowserWindow({show:false,webPreferences:{session:school,sandbox:true,contextIsolation:true,nodeIntegration:false}});
  const folder = join(root, 'chosen-homework-folder');
  await mkdir(folder);
  const files = await HomeworkFiles.open(folder);
  const saved = [], errors = [];
  let unavailable = false;
  const dispose = installSchoolDownloads(school, {
    stagingRoot:join(root,'staging'),
    destination:async contents => {assert.equal(contents.id,window.webContents.id);if(unavailable)throw new Error('Choose your homework folder');return files;},
    onSaved:path=>saved.push(path), onError:error=>errors.push(error.message),
  });
  const waitFor = async predicate => {
    const deadline = Date.now()+10000;
    while(!predicate()) {if(Date.now()>deadline)throw new Error('Download did not finish');await new Promise(resolve=>setTimeout(resolve,25));}
  };
  try {
    await window.loadURL(`http://127.0.0.1:${server.address().port}`);
    await window.webContents.executeJavaScript('document.querySelector("form").requestSubmit()');
    await waitFor(()=>saved.length===1);
    assert.equal(await readFile(join(folder,saved[0]),'utf8'),'original POST download');
    assert.equal(requests.filter(item=>item.path==='/file').length,1,'Must not refetch a POST download as GET');
    assert.equal(requests.find(item=>item.path==='/file').method,'POST');
    await window.webContents.executeJavaScript('document.querySelector("a").click()');
    await waitFor(()=>saved.length===2);
    assert.equal(saved[1],'materials/syllabus.pdf');
    assert.deepEqual(await readFile(join(folder,saved[1])),schoolPdf());
    const blob = `const link=document.createElement('a');link.href=URL.createObjectURL(new Blob(['blob contents']));link.download='notes.txt';link.click();`;
    await window.webContents.executeJavaScript(`{${blob}}`);
    await waitFor(()=>saved.length===3);
    assert.equal(saved[2],'materials/notes (1).txt');
    assert.equal(await readFile(join(folder,saved[0]),'utf8'),'original POST download');
    assert.equal(await readFile(join(folder,saved[2]),'utf8'),'blob contents');
    unavailable=true;
    await window.webContents.executeJavaScript(`{${blob}}`);
    await waitFor(()=>errors.length===1);
    assert.match(errors[0],/Choose your homework folder/);
    assert.equal(saved.length,3);
    for(let attempt=0;attempt<100 && (await readdir(join(root,'staging'))).length;attempt++) await new Promise(resolve=>setTimeout(resolve,25));
    assert.deepEqual(await readdir(join(root,'staging')),[]);
    assert.deepEqual(await readdir(join(root,'system-downloads')),[]);
    const receipt={mode:'controlled native Electron',passed:['clicked POST file keeps request and selected folder','clicked PDF saved unchanged without picker','blob download','duplicate preserves original','missing folder reports error','private staging cleaned','system Downloads remains empty'],root};
    await mkdir('.agents/studi-qa/native-downloads',{recursive:true});
    await writeFile('.agents/studi-qa/native-downloads/result.json',JSON.stringify(receipt,null,2));
    console.log(JSON.stringify(receipt));
  } finally {
    dispose(); window.destroy(); server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
}
