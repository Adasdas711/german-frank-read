import engine from "espeak-ng/dist/espeak-ng.js?raw";
// Text-only IPA generation for the separate builder. This module never produces audio.
async function embeddedWasm(): Promise<string> {
  if (import.meta.env.DEV)
    return (await import("./wasm-base64.txt?raw")).default;
  if (document.readyState === "loading") {
    await new Promise<void>((resolve) =>
      document.addEventListener("DOMContentLoaded", () => resolve(), {
        once: true,
      }),
    );
  }
  const data = document.getElementById("ipa-wasm")?.textContent?.trim();
  if (!data)
    throw Error(
      "В HTML отсутствуют данные eSpeak NG. Скачайте полный файл приложения.",
    );
  return data;
}
const engineText = engine
  .replace(/export default ESpeakNG;?/, "")
  .replaceAll("import.meta.url", '""');
let sentWasm = false;
let worker: Worker | undefined,
  seq = 0,
  idle: ReturnType<typeof setTimeout>;
const pending = new Map<
  number,
  { resolve: (v: any) => void; reject: (e: any) => void }
>();
function getWorker() {
  if (worker) return worker;
  const code =
    engineText +
    `\nlet binary,compiled;let queue=Promise.resolve();self.onmessage=e=>{const d=e.data;queue=queue.then(async()=>{try{if(!binary){const a=Uint8Array.from(atob(d.wasm),c=>c.charCodeAt(0));binary=new Uint8Array(await new Response(new Blob([a]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());compiled=await WebAssembly.compile(binary)}let logs=[];const args=['-v','de','--ipa=3','-q','--phonout','/ipa',d.text];const mod=await ESpeakNG({arguments:args,wasmBinary:binary,locateFile:()=>'',print:x=>logs.push(x),printErr:x=>logs.push(x),instantiateWasm:(imports,cb)=>{WebAssembly.instantiate(compiled,imports).then(instance=>cb(instance,compiled));return{};}});const data=mod.FS.readFile('/ipa',{encoding:'utf8'}).trim().replace(/[\\u200c\\u200d]/g,'');self.postMessage({id:d.id,data});}catch(e){self.postMessage({id:d.id,error:String(e.message||e)})}})};`;
  const url = URL.createObjectURL(
    new Blob([code], { type: "text/javascript" }),
  );
  sentWasm = false;
  worker = new Worker(url);
  URL.revokeObjectURL(url);
  worker.onmessage = (e) => {
    const p = pending.get(e.data.id);
    if (p) {
      pending.delete(e.data.id);
      e.data.error ? p.reject(Error(e.data.error)) : p.resolve(e.data.data);
    }
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(Error(e.message));
    pending.clear();
    worker?.terminate();
    worker = undefined;
  };
  return worker;
}
export async function phoneticIPA(text: string): Promise<string> {
  clearTimeout(idle);
  const w = getWorker(),
    id = ++seq;
  const wasm = sentWasm ? undefined : await embeddedWasm();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error("Генератор транскрипции не ответил за 45 секунд."));
    }, 45000);
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
        idle = setTimeout(() => {
          if (!pending.size) {
            worker?.terminate();
            worker = undefined;
          }
        }, 120000);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    w.postMessage({ id, text, ...(sentWasm ? {} : { wasm }) });
    sentWasm = true;
  });
}
