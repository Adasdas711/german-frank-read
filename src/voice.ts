import engine from "espeak-ng/dist/espeak-ng.js?raw";
// The large synth payload is inert HTML data, outside the startup JavaScript.
// The UI can run while the browser is still downloading this final part.
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
  const data = document.getElementById("espeak-wasm")?.textContent?.trim();
  if (!data)
    throw Error(
      "В HTML отсутствуют данные eSpeak NG. Скачайте полный файл приложения.",
    );
  return data;
}
import { toPhonemes } from "./ipa";
export { toPhonemes } from "./ipa";
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
    `\nlet binary,compiled;let queue=Promise.resolve();self.onmessage=e=>{const d=e.data;queue=queue.then(async()=>{try{if(!binary){const a=Uint8Array.from(atob(d.wasm),c=>c.charCodeAt(0));binary=new Uint8Array(await new Response(new Blob([a]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());compiled=await WebAssembly.compile(binary)}let logs=[];const args=d.kind==='ipa'?['-v','de','--ipa=3','-q','--phonout','/ipa',d.text]:['-v','de','-s',String(Math.round(175*d.rate)),'-w','/audio.wav',d.text];const mod=await ESpeakNG({arguments:args,wasmBinary:binary,locateFile:()=>'',print:x=>logs.push(x),printErr:x=>logs.push(x),instantiateWasm:(imports,cb)=>{WebAssembly.instantiate(compiled,imports).then(instance=>cb(instance,compiled));return{};}});const data=d.kind==='ipa'?mod.FS.readFile('/ipa',{encoding:'utf8'}).trim().replace(/[\\u200c\\u200d]/g,''):mod.FS.readFile('/audio.wav');self.postMessage({id:d.id,data});}catch(e){self.postMessage({id:d.id,error:String(e.message||e)})}})};`;
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
export async function voiceRequest(
  kind: "ipa" | "audio",
  text: string,
  rate = 1,
): Promise<any> {
  clearTimeout(idle);
  const w = getWorker(),
    id = ++seq;
  const wasm = sentWasm ? undefined : await embeddedWasm();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error("Синтезатор не ответил за 45 секунд."));
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
    w.postMessage({ id, kind, text, rate, ...(sentWasm ? {} : { wasm }) });
    sentWasm = true;
  });
}
let generation = 0;
let audio: AudioContext | undefined, source: AudioBufferSourceNode | undefined;
export function stop() {
  generation++;
  window.speechSynthesis?.cancel();
  source?.stop();
  source = undefined;
}
export function unlockAudio() {
  audio ??= new AudioContext();
  void audio.resume();
}
export async function speak(
  text: string,
  ipa: string | undefined,
  settings: { voice: string; rate: number },
  onEnd?: () => void,
) {
  stop();
  const current = generation;
  if (settings.voice === "system") {
    if (!("speechSynthesis" in window))
      throw Error("Системный голос недоступен. Выберите eSpeak NG.");
    const voices = speechSynthesis.getVoices(),
      v = voices.find((v) => v.lang.startsWith("de"));
    if (!v)
      throw Error(
        "Немецкий системный голос не установлен. Выберите eSpeak NG.",
      );
    const u = new SpeechSynthesisUtterance(text);
    u.voice = v;
    u.lang = "de-DE";
    u.rate = settings.rate;
    u.onend = () => onEnd?.();
    u.onerror = () => onEnd?.();
    speechSynthesis.speak(u);
    return;
  }
  unlockAudio();
  const input = ipa ? "[[" + toPhonemes(ipa) + "]]" : text;
  const bytes = await voiceRequest("audio", input, settings.rate);
  const buffer = await audio!.decodeAudioData(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  if (current !== generation) return 0;
  source = audio!.createBufferSource();
  source.buffer = buffer;
  source.onended = () => {
    if (current === generation) onEnd?.();
  };
  source.connect(audio!.destination);
  source.start();
  return buffer.duration;
}
