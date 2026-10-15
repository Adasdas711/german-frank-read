// eSpeak ASCII phonemes, longest IPA sequences first. Unknown input fails explicitly.
const map: Record<string, string> = {
  t͡s: "ts",
  t͡ʃ: "tS",
  d͡ʒ: "dZ",
  tʃ: "tS",
  dʒ: "dZ",
  aɪ̯: "aI",
  aʊ̯: "aU",
  ɔʏ̯: "OY",
  aɪ: "aI",
  aʊ: "aU",
  ɔʏ: "OY",
  ɐ̯: "R",
  n̩: "n",
  l̩: "l",
  m̩: "m",
  ɪ: "I",
  ʏ: "Y",
  ʊ: "U",
  ɛ: "E",
  œ: "W",
  ɔ: "O",
  ə: "@",
  ɐ: "3",
  ɑ: "A",
  ɒ: "Q",
  ʌ: "V",
  æ: "a",
  ʁ: "R",
  r: "r",
  ɹ: "r",
  ʀ: "R",
  ç: "C",
  ʃ: "S",
  ʒ: "Z",
  ŋ: "N",
  θ: "T",
  ð: "D",
  ɡ: "g",
  ɜ: "3",
  ɲ: "n^",
  ɾ: "r",
  ˈ: "'",
  ˌ: ",",
  ː: ":",
  ˑ: ":",
  ʔ: "?",
  ɫ: "l",
  ʲ: ";",
  "̯": "",
  "̩": "",
  "͡": "",
  "͜": "",
  ʰ: "",
  "̃": "~",
  ɶ: "W",
  ʋ: "v",
  β: "B",
  ɣ: "Q",
  ɟ: "J",
  ɦ: "h",
  ɕ: "s;",
  ʑ: "z;",
  ʊ̈: "U",
  y: "y",
  ø: "2",
};
const keys = Object.keys(map).sort((a, b) => b.length - a.length);
export function toPhonemes(ipa: string) {
  ipa = ipa.replace(/[\u200c\u200d]/g, "");
  let out = "";
  for (let i = 0; i < ipa.length; ) {
    const k = keys.find((k) => ipa.startsWith(k, i));
    if (k) {
      out += map[k];
      i += k.length;
    } else {
      const c = ipa[i++];
      if (/[a-zA-Z .\-\n|()]/.test(c))
        out += c === "|" ? "_" : c === "." ? "" : c;
      else throw Error("Неподдерживаемый символ IPA: " + c);
    }
  }
  return out;
}
