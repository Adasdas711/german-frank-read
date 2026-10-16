"""Extract the supplied Frank-method PDF without inventing or replacing the story.
Usage: python scripts/extract-immensee.py "/path/to/Theodor Storm. Immensee.pdf"
Requires PyMuPDF. The checked-in source JSON is sufficient for rebuilding the book.
"""
import sys,re,json,hashlib,difflib
from pathlib import Path
import fitz
pdf=Path(sys.argv[1]);doc=fitz.open(pdf)
RUS=re.compile('[А-Яа-яЁё]')
WORD=re.compile(r"[^\W\d_]+(?:[’'\-][^\W\d_]+)*",re.UNICODE)
chapters=[];segments=[];kind=None;lines=[];paren=0

def normalized(s):
 s=s.replace('\xa0',' ').replace('\u00ad','')
 s=re.sub(r'(?<=[A-Za-zÄÖÜäöüßА-Яа-яЁё])-\n(?=[A-Za-zÄÖÜäöüßА-Яа-яЁё])','',s)
 return re.sub(r'\s+',' ',s).strip()
def flush():
 global lines,kind
 if lines:segments.append((kind,normalized('\n'.join(lines))))
 lines=[];kind=None
for pi in range(7,len(doc)):
 for block in doc[pi].get_text('dict')['blocks']:
  for line in block.get('lines',[]):
   spans=[s for s in line['spans'] if s['text'].strip()]
   if not spans:continue
   if max(s['size'] for s in spans)<11.8:continue
   text=''.join(s['text'] for s in spans)
   if max(s['size'] for s in spans)>14:
    if text.strip()=='Theodor Storm. Immensee':continue
    flush();segments.append(('H',normalized(text)));paren=0;continue
   annotated=any('Bold' in s['font'] or 'Italic' in s['font'] for s in spans) or bool(RUS.search(text)) or (kind=='A' and paren>0)
   next_kind='A' if annotated else 'O'
   if next_kind!=kind:flush();kind=next_kind
   lines.append(text)
   if kind=='A':paren+=text.count('(')-text.count(')')
flush()
print('segment types',[(k,sum(1 for x,_ in segments if x==k)) for k in ['H','A','O']])
# Report extraction structure before creating the final aligned source.
for i,(k,text) in enumerate(segments):
 if k=='H': print('CHAPTER',text)
 elif (k=='A' and (i+1>=len(segments) or segments[i+1][0]!='O')) or (k=='O' and (i==0 or segments[i-1][0]!='A')):
  raise ValueError(f'Unpaired source paragraph {i}: {k} {text[:130]}')

def parse_annotated(raw):
 chunks=[];start=0;i=0
 while i<len(raw):
  if raw[i]!='(':i+=1;continue
  depth=1;j=i+1
  while j<len(raw) and depth:
   depth+= (raw[j]=='(')-(raw[j]==')');j+=1
  if depth:raise ValueError('Unbalanced source hint: '+raw[max(0,i-50):i+100])
  hint=raw[i+1:j-1]
  if not RUS.search(hint):i=j;continue
  source=raw[start:i].rstrip()
  if source:chunks.append([source,hint])
  elif chunks and isinstance(chunks[-1],list):chunks[-1][1]+='; '+hint
  else:raise ValueError('Hint without source '+hint)
  start=j;i=j
 if raw[start:]:chunks.append(raw[start:])
 plain=''.join(c if isinstance(c,str) else c[0] for c in chunks)
 # The separating space belongs to the original text, not to the hint brackets.
 return chunks,plain

def project(chunks,raw,original):
 match=difflib.SequenceMatcher(None,raw,original,autojunk=False)
 bounds=[0]*(len(raw)+1)
 for tag,a,b,c,d in match.get_opcodes():
  for i in range(a,b+1):bounds[i]= c+round((i-a)*(d-c)/max(1,b-a))
 bounds[-1]=len(original)
 result=[];cursor=0;previous=0
 for chunk in chunks:
  text=chunk if isinstance(chunk,str) else chunk[0];end=cursor+len(text)
  target=original[previous:bounds[end]];previous=bounds[end];cursor=end
  if not target:
   if isinstance(chunk,list):raise ValueError('Empty projected hint: '+str(chunk))
   continue
  result.append(target if isinstance(chunk,str) else [target,chunk[1]])
 assert ''.join(c if isinstance(c,str) else c[0] for c in result)==original
 return result,match.ratio()

mismatches=[];empty=[];total_hints=0;chapters=[]
for i,(kind,text) in enumerate(segments):
 if kind=='H':chapters.append({'n':len(chapters)+1,'title':text,'fragments':[]});continue
 if kind!='A':continue
 assert segments[i+1][0]=='O'
 original=segments[i+1][1]
 # The unannotated repetition omits two words that remain in the annotated
 # original on PDF page 12; restore them from that same source.
 if len(chapters)==2 and len(chapters[-1]['fragments'])==2:
  original=original.replace('geschlagenen Nagels dennoch','geschlagenen Nagels seine Bank dennoch')
 chunks,raw=parse_annotated(text)
 if RUS.search(raw):raise ValueError('Cyrillic outside hints: '+raw)
 chunks,ratio=project(chunks,raw,original)
 if ratio<.995:mismatches.append((len(chapters),len(chapters[-1]['fragments'])+1,round(ratio,4),raw[:100],original[:100]))
 spans=[];offset=0
 for chunk in chunks:
  source=chunk if isinstance(chunk,str) else chunk[0]
  if isinstance(chunk,list):spans.append((offset,offset+len(source),chunk[1].split(';')[0].strip()));total_hints+=1
  offset+=len(source)
 translations=[]
 for sentence in re.finditer(r'[^.!?]+[.!?]+[»”"\x27]*|[^.!?]+$',original):
  if not sentence.group().strip():continue
  parts=[hint for start,end,hint in spans if start<sentence.end() and end>sentence.start()]
  # Leave missing translations visible in the extraction audit, never invent them.
  if not parts:
   bare=sentence.group().strip()
   if not WORD.search(bare):parts=[bare]
   elif bare=='“ fragte sie.':parts=['— спросила она.']
   elif bare=='“ fragte Reinhard.':parts=['— спросил Райнхард.']
  translations.append(' '.join(parts))
  if not parts:empty.append((len(chapters),len(chapters[-1]['fragments'])+1,sentence.group().strip()))
 chapters[-1]['fragments'].append({'chunks':chunks,'translation':translations})
print('mismatches',len(mismatches),mismatches[:20]);print('untranslated sentences',len(empty),empty[:35]);print('hint count',total_hints)
source={'id':'9b597927-66e7-4b7a-a540-ae3e0583fc22','meta':{'title':'Immensee','titleRu':'Иммензее. Повесть об одной любви','author':'Theodor Storm','level':'B1','source':'Theodor Storm. Immensee.pdf; Издательский дом ВКН, 2018; русская адаптация по методу Ильи Франка: Ирина Солнцева. SHA-256 '+hashlib.sha256(pdf.read_bytes()).hexdigest(),'license':'Оригинал Теодора Шторма — общественное достояние. Русская адаптация: © И. Франк, © ООО «Издательство ВКН», 2018; предоставлена пользователем в PDF. Автоматическое извлечение и сопоставление с чистым текстом PDF; не новое сокращение или пересказ.'},'chapters':chapters,'lemmas':[],'forms':{}}
print('Words',sum(len(WORD.findall(''.join(c if isinstance(c,str) else c[0] for c in f['chunks']))) for ch in chapters for f in ch['fragments']))

# Build a dictionary only from explicit glossary entries and single-word hints.
import unicodedata
def unaccent(s):
 return unicodedata.normalize('NFC', ''.join(c for c in unicodedata.normalize('NFD',s) if c!='\u0301'))
lemmas={}
for chapter in chapters:
 for fragment in chapter['fragments']:
  for chunk in fragment['chunks']:
   if isinstance(chunk,str):continue
   for entry in chunk[1].split(';')[1:]:
    match=re.match(r'^\s*([^–]+?)\s*–\s*(.+)$',entry)
    if not match:continue
    left,right=match.groups();left=unaccent(left.strip());right=right.strip()
    if RUS.search(left) or not RUS.search(right) or len(left)>65 or not re.match(r'^[A-Za-zÄÖÜäöüß ,/()’\x27-]+$',left):continue
    pos='noun' if re.match(r'^(der|die|das) ',left) else ''
    if not pos and re.match(r'^[a-zäöüß]+(?:en|ern|eln)$',left):pos='verb'
    lemmas.setdefault(left,[left,right,pos])
source['lemmas']=list(lemmas.values())
source['extraction']={'pdfSha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'pdfPages':len(doc),'chapterCount':len(chapters),'hintCount':total_hints,'corrections':[{'chapter':2,'block':3,'pdfPage':12,'text':'seine Bank','reason':'Present in the annotated original; missing in the repeated clean paragraph.'}],'parallel':'Russian sentence glosses assembled from the supplied inline hints; the two unannotated dialogue tags were translated literally.'}
assert not empty,empty
Path('src/immensee-source.json').write_text(json.dumps(source,ensure_ascii=False,indent=2)+'\n')
print('Saved full story:',len(source['lemmas']),'explicit glossary entries')
