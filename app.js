/* 임상시험 매칭 데모 v3. v2(재생 방식)에 환자 모드 기본 화면으로 근거 지도(evidence map)를 더했다.
 * v2: web_demo v1의 데이터와 동작을 그대로 쓰고 화면 구성만 바꿨다.
 * 화면은 그래프·브리핑·카드를 그대로 그린다. 내용 문장은 에이전트 6 출력만 쓰고,
 * 화면이 직접 쓰는 글자는 버튼·제목·상태 이름 같은 고정 UI 문구뿐이다.
 * 데이터: data/index.json, data/<pid>.<state>.json (scripts/build_bundle.py), data/ko.json (선택, 번역)
 */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const S = {
  typed: {},   // 시연용 입력창에 넣은 내용 (card_id -> {date, text}). 2차 판정에는 쓰지 않고 따로 보여 준다
  resp: {},    // 환자 응답: pid -> { "카드 종류|기준 ID": {answer: yes|no|unsure, review: null|ok|more} }. card_id는 2차 판정 뒤 바뀌어서 키로 쓰지 않는다
  index: null, pid: null, bundles: {}, state: "before", view: "patient",
  trialSel: null, selSent: null, filter: "all", ko: null, cardKo: null, lang: "orig",
  pview: "map", mapTrial: null, mapLinks: [],
};

/* ---------- graph model (v1 그대로) ---------- */
function model(b) {
  if (b._m) return b._m;
  const nodes = new Map(), out = new Map(), inn = new Map();
  for (const n of b.graph.nodes) nodes.set(n.id, n);
  for (const [a, rel, c] of b.graph.edges) {
    if (!out.has(a)) out.set(a, []);
    out.get(a).push([rel, c]);
    if (!inn.has(c)) inn.set(c, []);
    inn.get(c).push([rel, a]);
  }
  const criteria = new Map(), decs = new Map();
  for (const n of b.graph.nodes) {
    if (n.kind === "trial") criteria.set(n.id.slice(6), (out.get(n.id) || []).filter(([r]) => r === "has_criterion").map(([, c]) => nodes.get(c)));
    if (n.kind === "decision") {
      if (!decs.has(n.criterion_id)) decs.set(n.criterion_id, []);
      decs.get(n.criterion_id).push(n);
    }
  }
  for (const v of decs.values()) v.sort((x, y) => x.round - y.round);
  const cardsByCrit = new Map();
  for (const c of b.cards) for (const it of c.items || []) {
    const k = it.trial_id + "|" + it.criterion_id;
    if (!cardsByCrit.has(k)) cardsByCrit.set(k, []);
    if (!cardsByCrit.get(k).includes(c)) cardsByCrit.get(k).push(c);
  }
  b._m = { nodes, out, inn, criteria, decs, cardsByCrit };
  return b._m;
}
const latest = (m, critId) => { const d = m.decs.get(critId); return d ? d[d.length - 1] : null; };
const critOf = (id) => id.replace(/^crit:/, "");

function statusInfo(dec, critType) {
  if (!dec) return { key: "none", text: "판정 없음" };
  if (dec.judged_by === "pc:llm_missing") return { key: "llmfail", text: "판정 실패" };
  const ex = critType === "exclusion";
  if (dec.status === "PASS") return { key: "pass", text: ex ? "제외 사유 없음" : "충족" };
  if (dec.status === "FAIL") return { key: "fail", text: ex ? "제외 해당" : "미충족" };
  if (dec.status === "CONFLICT") return { key: "conflict", text: "기록끼리 다름" };
  if (dec.reason === "EXPIRED") return { key: "expired", text: "기간 지남" };
  if (dec.reason === "UNSUPPORTED") return { key: "unsup", text: "확인 필요" };
  // 에이전트 3이 정상 소견·약 목록으로 PASS를 추론했지만 엄격 규칙(pc:strict_*)으로 MISSING에 둔 판정: 기록은 있으므로 '기록 없음' 대신
  if ((dec.rule_tags || []).some((t) => t === "pc:strict_normal_finding_inference" || t === "pc:strict_list_inference"))
    return { key: "inferred", text: ex ? "제외 사유 없어 보임" : "충족으로 보임" };
  return { key: "missing", text: "기록 없음" };
}
const ORDER = ["pass", "fail", "unsup", "expired", "inferred", "missing", "conflict", "llmfail", "none"];
const SHORT = { pass: "충족", fail: "미충족", unsup: "확인 필요", expired: "기간 지남", inferred: "기록상 추정", missing: "기록 없음", conflict: "기록끼리 다름", llmfail: "판정 실패", none: "판정 없음" };
const ICON = {
  pass: '<path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  fail: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  unsup: '<path d="M6 6.2a2 2 0 1 1 2.8 1.8c-.6.3-.8.7-.8 1.3v.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="12" r="0.9" fill="currentColor"/>',
  expired: '<circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v3.2l2 1.3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  inferred: '<path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2.2 2"/>',
  missing: '<path d="M4.5 8h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  conflict: '<path d="M4 6h8M4 10h8M10 3.5l-4 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  llmfail: '<path d="M8 4v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="11.8" r="1" fill="currentColor"/>',
  none: '<circle cx="8" cy="8" r="1.2" fill="currentColor"/>',
};
const icon = (k) => `<svg class="ic" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">${ICON[k] || ""}</svg>`;
const pill = (si, extra = "") => `<span class="st st-${si.key} ${extra}">${icon(si.key)}<span>${esc(si.text)}</span></span>`;

const LABEL = { eligible: ["eligible", "조건 맞음"], potential: ["potential", "확인 필요"], ineligible: ["ineligible", "해당 안 됨"] };
const labelBadge = (l) => { const [c, t] = LABEL[l] || ["plain", l || "-"]; return `<span class="tl tl-${c}">${c === "eligible" ? icon("pass") : ""}<span>${esc(t)}</span></span>`; };

const TYPE = { answered_review: "답 받음·의료진 확인 중", new_test: "검사 안내", clinician_confirmation: "의사 확인", patient_question: "질문", lab_check: "검사 결과 찾기", med_record_check: "기록 찾기", med_history_check: "과거력 확인" };
const REL = { supports: "뒷받침", insufficient_for: "근거 부족", expired_for: "기간 지남", computes: "계산", answers: "답 근거 (판정에 쓰이지 않음)", decided_as: "판정한 기준" };
const KEYS = { status: "상태", reason: "이유", action: "다음 행동", note: "판정 메모", missing_fact: "필요한 정보", judged_by: "판정 방식", round: "라운드",
  concept: "개념", term: "용어", value: "값", unit: "단위", observed_date: "관찰일", certainty: "확실성", subject: "대상",
  type: "종류", administrative: "행정 기준", cohort: "코호트", why: "판정 이유", by: "판정 주체",
  operator: "비교", threshold: "기준값", threshold_in_base_unit: "기준값(기본 단위)", value_unit: "값 단위", days_before: "기준일 전(일)", window_days: "허용 기간(일)", window_source: "기간 출처", lo: "하한", hi: "상한", name: "이름" };

const koOf = (id) => (S.ko && S.ko.map[id]) || "";
/* 카드 질문 번역 (data/card_ko.json, 기준 ID 키). 없으면 기준 번역, 그것도 없으면 영어 missing_fact */
const qOf = (it) => { const q = S.cardKo && S.cardKo.items[it.criterion_id]; return q ? { text: q.ko, ko: true } : koOf("crit:" + it.criterion_id) ? { text: koOf("crit:" + it.criterion_id), ko: true } : { text: it.missing_fact || it.criterion_text || "", ko: false }; };
const rKey = (c, it) => c.type + "|" + it.criterion_id;
const myResp = () => (S.resp[S.pid] = S.resp[S.pid] || {});
/* 시연용 답 문서 앞에 붙은 표시 문장. 화면 어디서나 같은 방식으로 떼고 '시연용 예시' 태그로 보인다 */
const DEMO_RE = /^Illustrative answer for the loop demo only\.\s*/;
const demoSplit = (t) => { const s = String(t || ""), m = s.match(DEMO_RE); return { demo: !!m, cut: m ? m[0].length : 0, text: m ? s.slice(m[0].length) : s }; };
const DEMO_TAG = `<span class="tag tag-demo">시연용 예시</span>`;

/* ---------- sentence grouping (에이전트 6 README 2장 규칙, v1 그대로) ---------- */
function trialOfRefs(refs) {
  const ids = new Set();
  for (const r of refs) {
    let m;
    if ((m = r.match(/^(?:trial|label):(NCT\d+)/))) ids.add(m[1]);
    else if ((m = r.match(/^(?:dec|calc):(NCT\d+):/))) ids.add(m[1]);
    else if ((m = r.match(/^crit:(NCT\d+)-/))) ids.add(m[1]);
  }
  return ids.size === 1 ? [...ids][0] : null;
}
function groupSentences(brief) {
  const out = { pre: [], trials: [], post: [] };
  let prev = null, seenTrial = false;
  brief.sentences.forEach((s, i) => {
    let t = trialOfRefs(s.refs);
    if (!t && s.refs.length && s.refs.every((r) => /^(ev|src):/.test(r))) t = prev;
    const item = { ...s, i, trial: t };
    if (t) {
      seenTrial = true;
      const last = out.trials[out.trials.length - 1];
      if (last && last.trial_id === t) last.sents.push(item);
      else out.trials.push({ trial_id: t, sents: [item] });
      prev = t;
    } else if (!seenTrial) out.pre.push(item);
    else { out.post.push(item); prev = null; }
  });
  return out;
}

/* ---------- before/after diff (v1 그대로) ---------- */
function diff() {
  const a = S.bundles.after, b = S.bundles.before;
  if (!a || !b || S.state !== "after") return null;
  const ma = model(a), mb = model(b);
  const changed = new Map();
  for (const [cid, list] of ma.decs) {
    const x = list[list.length - 1], y = latest(mb, cid);
    if (!y || x.status !== y.status || x.reason !== y.reason) changed.set(cid, { before: y, after: x });
  }
  const labels = [];
  for (const n of a.graph.nodes) if (n.kind === "trial_decision") {
    const o = mb.nodes.get(n.id);
    if (o && o.label !== n.label) labels.push({ trial_id: n.id.slice(6), before: o.label, after: n.label });
  }
  const answered = new Set(a.meta.answers.map((x) => x.card_id));
  const target = new Set();
  for (const c of b.cards) if (answered.has(c.card_id)) for (const it of c.items) target.add(it.criterion_id);
  // card_id is renumbered on every agent 5 run, so cards are matched item by item on (type, criterion)
  const ik = (c, it) => c.type + "|" + it.criterion_id;
  const afterItems = new Set(a.cards.flatMap((c) => (c.items || []).map((it) => ik(c, it))));
  const beforeItems = new Set(b.cards.flatMap((c) => (c.items || []).map((it) => ik(c, it))));
  const afterIds = new Set(a.cards.map((c) => c.card_id));
  // a5j-0.3.1: an answered criterion's card turns into an answered_review card (clinician checks the answer).
  // That card is the successor of the 1st-round card, not a dropped card plus a new one.
  const reviewCards = a.cards.filter((c) => c.type === "answered_review");
  const reviewed = new Set(reviewCards.flatMap((c) => (c.items || []).map((it) => it.criterion_id)));
  const answeredCards = [];
  const goneCards = [], lostItems = [], renumbered = [];
  for (const c of b.cards) {
    const its = c.items || [];
    if (its.length && its.every((it) => reviewed.has(it.criterion_id))) { answeredCards.push(c); continue; }
    const missing = its.filter((it) => !afterItems.has(ik(c, it)) && !reviewed.has(it.criterion_id));
    for (const it of missing) { const x = latest(ma, it.criterion_id); if (x && x.status === "UNKNOWN") lostItems.push({ card: c, item: it }); }
    if (!missing.length && !afterIds.has(c.card_id)) renumbered.push(c);
    if (missing.length === its.length && missing.every((it) => { const x = latest(ma, it.criterion_id); return x && x.status !== "UNKNOWN"; })) goneCards.push(c);
  }
  const newCards = a.cards.filter((c) => c.type !== "answered_review" && (c.items || []).some((it) => !beforeItems.has(ik(c, it))));
  const sentSet = (bb, aud) => new Set(bb.briefing[aud].sentences.map((s) => s.text));
  return { changed, labels, target, goneCards, lostItems, renumbered, newCards, reviewCards, reviewed, beforeSents: { patient: sentSet(b, "patient"), clinician: sentSet(b, "clinician") } };
}

function cardKey(c) { return c.type + "|" + (c.items || []).map((it) => it.criterion_id).sort().join(","); }
function isAdminCard(b, c) {
  const m = model(b);
  const its = c.items || [];
  return its.length > 0 && its.every((it) => { const n = m.nodes.get("crit:" + it.criterion_id); return n && n.administrative; });
}

/* ---------- loading ---------- */
async function getJSON(p) {
  const r = await fetch(p);
  if (!r.ok) throw new Error(p + " " + r.status);
  return r.json();
}
async function loadPatient(pid) {
  S.pid = pid; S.bundles = {}; S.trialSel = null; S.mapTrial = null; S.filter = "all"; closePanel();
  $("#main").innerHTML = `<div class="skeleton" aria-hidden="true"><span></span><span></span><span></span></div><p class="visually-hidden">불러오는 중입니다.</p>`;
  const p = S.index.patients.find((x) => x.patient_id === pid);
  for (const st of p.states) S.bundles[st.state] = await getJSON("data/" + st.file);
  S.state = "before";
  render();
}
function readHash() {
  const h = location.hash.replace("#", "");
  if (h === "patient" || h === "clinician") S.view = h;
}
async function init() {
  readHash();
  try {
    S.index = await getJSON("data/index.json");
  } catch (e) {
    $("#main").innerHTML = `<div class="state-box"><h2>데이터를 읽지 못했습니다</h2><p>폴더에서 <code>python3 -m http.server</code>로 띄운 뒤 다시 열어 주세요. 파일을 직접 열면 JSON을 읽지 못합니다.</p><p class="meta">${esc(e.message)}</p></div>`;
    return;
  }
  try { S.ko = await getJSON("data/ko.json"); } catch (e) { S.ko = null; }
  try { S.cardKo = await getJSON("data/card_ko.json"); } catch (e) { S.cardKo = null; }
  const sel = $("#patient-select");
  sel.innerHTML = S.index.patients.map((p) => `<option value="${p.patient_id}">${p.patient_id}${p.states.length > 1 ? " (2차 판정 데모)" : ""}</option>`).join("");
  sel.onchange = () => loadPatient(sel.value);
  for (const b of document.querySelectorAll("#view-toggle button")) b.onclick = () => { S.view = b.dataset.view; history.replaceState(null, "", "#" + S.view); closePanel(); render(); };
  window.addEventListener("hashchange", () => { readHash(); render(); });
  $("#panel-close").onclick = closePanel;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closePanel(); if (S.mapPin) { S.mapPin = null; hlMap("", false); } } });   // Esc: 패널 닫기 + 선 고정 해제
  await loadPatient(S.index.patients[0].patient_id);
}

/* ---------- render ---------- */
const cur = () => S.bundles[S.state];

function render() {
  const b = cur();
  if (!b) return;
  for (const x of document.querySelectorAll("#view-toggle button")) {
    const on = x.dataset.view === S.view;
    x.classList.toggle("on", on); x.setAttribute("aria-pressed", on);
  }
  document.body.dataset.view = S.view;
  const states = Object.keys(S.bundles);
  const st = $("#state-toggle");
  st.innerHTML = states.length > 1
    ? `<div class="steps-in"><span class="steps-label">판정 차수</span>
        <button type="button" data-s="before" class="${S.state === "before" ? "on" : ""}" aria-pressed="${S.state === "before"}"><span class="num">1</span>1차 판정</button>
        <svg class="arrow" width="28" height="12" viewBox="0 0 28 12" aria-hidden="true"><path d="M1 6h24M20 1.5L25.5 6 20 10.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <button type="button" data-s="after" class="${S.state === "after" ? "on" : ""}" aria-pressed="${S.state === "after"}"><span class="num">2</span>2차 판정</button></div>`
    : "";
  st.hidden = states.length < 2;
  for (const x of document.querySelectorAll("#state-toggle button")) x.onclick = () => { S.state = x.dataset.s; S.selSent = null; closePanel(); render(); };
  $("#patient-meta").innerHTML = `<span>기준일 <span class="mono">${esc(b.meta.as_of)}</span></span><span>문서 <span class="mono">${b.patient.documents.length}</span>개</span>`;
  $("#build-meta").innerHTML = `<dl class="kv">${[["에이전트 3", b.meta.agent3], ["근거", b.meta.agent2], ["에이전트 6", b.meta.agent6 + " 틀 문장"], ["에이전트 5", b.meta.agent5]].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
  const d = diff();
  renderUpdate(d);
  const main = $("#main");
  const switched = main.dataset.view && main.dataset.view !== S.view;
  main.dataset.view = S.view;
  main.innerHTML = S.view === "patient" ? patientView(b, d) : clinicianView(b, d);
  if (switched) { main.classList.remove("view-enter"); void main.offsetWidth; main.classList.add("view-enter"); }
  wire();
  wireMap();
}

function sentHTML(s, d, aud, b, extra = "") {
  const m = model(b);
  const cls = ["sent", s.kind === "rule" ? "rule" : "", s.kind === "heading" ? "heading" : "",
    d && !d.beforeSents[aud].has(s.text) ? "changed" : "", S.selSent === aud + s.i ? "sel" : "", extra].join(" ");
  const cards = new Set();
  for (const r of s.refs) {
    const mm = r.match(/^dec:(NCT\d+):([^:]+):r\d+$/);
    if (mm) for (const c of m.cardsByCrit.get(mm[1] + "|" + mm[2]) || []) if (c.audience === aud || aud === "clinician") cards.add(c.card_id);
  }
  const link = cards.size ? ` <button type="button" class="card-link" data-cards="${esc([...cards].join(","))}">할 일 ${cards.size}</button>` : "";
  let html = esc(s.text);
  for (const r of s.refs) {
    const gl = r.startsWith("gloss:") && b.glossary && b.glossary[r];
    if (!gl || !gl.ko) continue;
    const ko = esc(gl.ko), at = html.indexOf(ko);
    if (at >= 0 && !html.slice(0, at).includes('data-tip="' + esc(gl.en) + '"'))
      html = html.slice(0, at) + `<span class="term" data-tip="${esc(gl.en)}">${ko}</span>` + html.slice(at + ko.length);
  }
  return `<span class="${cls}" data-sent="${aud}:${s.i}" tabindex="0" role="link" aria-label="근거 보기: ${esc(s.text)}">${html}</span>${link}`;
}

/* the strip: one cell per criterion, inclusion and exclusion on two rows */
function tally(b, tid) {
  const m = model(b), c = {};
  for (const cr of m.criteria.get(tid) || []) {
    const k = statusInfo(latest(m, critOf(cr.id)), cr.type).key;
    c[k] = (c[k] || 0) + 1;
  }
  return c;
}
function strip(b, tid, d, opts = {}) {
  const m = model(b), crits = m.criteria.get(tid) || [];
  const row = (type) => {
    const cs = crits.filter((c) => c.type === type);
    if (!cs.length) return "";
    return `<div class="strip-row"><span class="strip-name">${type === "inclusion" ? "포함" : "제외"}</span><div class="cells">${cs.map((cr) => {
      const cid = critOf(cr.id), dec = latest(m, cid), si = statusInfo(dec, cr.type);
      const ch = d && d.changed.get(cid);
      return `<button type="button" class="cell c-${si.key}${ch ? " moved" : ""}" data-refs="${esc(dec ? dec.id : cr.id)}" aria-label="${esc(cid)} ${esc(si.text)}${ch ? ", 2차 판정에서 바뀜" : ""}" title="${esc(cid)}: ${esc(si.text)}">${icon(si.key)}</button>`;
    }).join("")}</div></div>`;
  };
  const t = tally(b, tid);
  const legend = ORDER.filter((k) => t[k]).map((k) => opts.filter
    ? `<button type="button" class="lg lg-${k}${S.filter === k ? " on" : ""}" data-filter="${k}" aria-pressed="${S.filter === k}">${icon(k)}<span>${SHORT[k]}</span><span class="mono">${t[k]}</span></button>`
    : `<span class="lg lg-${k}">${icon(k)}<span>${SHORT[k]}</span><span class="mono">${t[k]}</span></span>`).join("");
  const all = opts.filter ? `<button type="button" class="lg${S.filter === "all" ? " on" : ""}" data-filter="all" aria-pressed="${S.filter === "all"}"><span>전체</span><span class="mono">${crits.length}</span></button>` : "";
  return `<div class="strip">${row("inclusion")}${row("exclusion")}<div class="legend">${all}${legend}</div></div>`;
}

function patientView(b, d) {
  const order = trialOrder(b);
  if (!S.mapTrial || !order.includes(S.mapTrial)) S.mapTrial = order[0];
  const g = groupSentences(b.briefing.patient);
  const seg = `<div class="seg seg-sm pview" role="group" aria-label="보기 방식"><button type="button" data-pview="map" class="${S.pview === "map" ? "on" : ""}" aria-pressed="${S.pview === "map"}">근거 지도</button><button type="button" data-pview="list" class="${S.pview === "list" ? "on" : ""}" aria-pressed="${S.pview === "list"}">목록으로 보기</button></div>`;
  if (S.pview === "list") return patientList(b, d, seg);
  let h = `<div class="pt"><div class="pt-main">`;
  h += `<div class="lede">${g.pre.map((s) => sentHTML(s, d, "patient", b)).join("")}</div>`;
  h += `<section class="hero"><h2>내 기록으로 살펴본 임상시험 <span class="num">${order.length}</span>건</h2>${seg}</section>`;
  h += trialTabs(b, d, order);
  h += evidenceMap(b, d, S.mapTrial);
  if (g.post.length) h += `<section class="notes"><h2>참여 전에 알아 두실 것</h2><ul>${g.post.map((s) => sentHTML(s, d, "patient", b)).map((x) => `<li>${x}</li>`).join("")}</ul></section>`;
  h += `</div><aside class="pt-side" id="todo" aria-labelledby="todo-h"><h2 id="todo-h">내가 할 일</h2>${todoHTML(b, d)}</aside></div>`;
  return h;
}

function patientList(b, d, seg) {
  const g = groupSentences(b.briefing.patient), m = model(b);
  let h = `<div class="pt">`;
  h += `<div class="pt-main">`;
  h += `<div class="lede">${g.pre.map((s) => sentHTML(s, d, "patient", b)).join("")}</div>`;
  h += `<section class="hero"><h2>내 기록으로 살펴본 임상시험 <span class="num">${g.trials.length}</span>건</h2>${seg}</section>`;
  h += recordSummary(b);
  g.trials.forEach((t, idx) => {
    const lab = m.nodes.get("label:" + t.trial_id);
    const ch = d && d.labels.find((x) => x.trial_id === t.trial_id);
    const [head, ...rest] = t.sents;
    const facts = rest.filter((s) => !foldRule(s)), rules = rest.filter(foldRule);
    h += `<article class="trial" id="trial-${esc(t.trial_id)}">
      <header class="trial-top">
        ${labelBadge(lab && lab.label)}${ch ? `<span class="moved-note">${esc(LABEL[ch.before][1])} <svg width="16" height="10" viewBox="0 0 16 10" aria-hidden="true"><path d="M1 5h12M9.5 1.5L13 5 9.5 8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg> ${esc(LABEL[ch.after][1])}</span>` : ""}
        <span class="mono nct">${esc(t.trial_id)}</span>
      </header>
      <h2 class="trial-head">${sentHTML(head, d, "patient", b)}</h2>
      ${strip(b, t.trial_id, d)}
      <div class="facts">${facts.map((s) => `<p>${sentHTML(s, d, "patient", b)}</p>`).join("")}</div>
      ${rules.length ? `<details class="fold"><summary>이 시험에 대해 더 보기</summary><div class="facts">${rules.map((s) => `<p>${sentHTML(s, d, "patient", b)}</p>`).join("")}</div></details>` : ""}
    </article>`;
  });
  if (g.post.length) h += `<section class="notes"><h2>참여 전에 알아 두실 것</h2><ul>${g.post.map((s) => `<li>${sentHTML(s, d, "patient", b)}</li>`).join("")}</ul></section>`;
  h += `</div>`;
  h += `<aside class="pt-side" id="todo" aria-labelledby="todo-h"><h2 id="todo-h">내가 할 일</h2>${todoHTML(b, d)}</aside>`;
  h += `</div>`;
  return h;
}

const DOC_KO = { registration: "등록 정보", clinic_note: "진료 기록", lab_result: "검사 결과", medication_record: "투약 기록", imaging_report: "영상 검사", pathology_report: "병리 검사", patient_interview: "문진", discharge_summary: "퇴원 요약" };
function recordSummary(b) {
  const docs = [...b.patient.documents].sort((x, y) => (x.date < y.date ? 1 : -1));
  return `<section class="records" aria-labelledby="rec-h"><div class="records-head"><h3 id="rec-h">판정에 쓴 내 기록</h3><p class="meta"><span>문서 <span class="num">${docs.length}</span>개</span><span>최근 <span class="num">${esc(docs[0] ? docs[0].date : "-")}</span></span></p></div>
    <ul class="doc-list">${docs.map((x) => `<li><button type="button" class="doc-chip" data-doc="${esc(x.doc_id)}"><span class="doc-type">${esc(DOC_KO[x.type] || x.type)}</span><span class="num">${esc(x.date)}</span></button></li>`).join("")}</ul></section>`;
}

function trialNo(b, tid) {
  const i = b.ranking.ranking.indexOf(tid);
  return i >= 0 ? `${i + 1}번 시험` : null;
}
function cardHTML(c, b, d, aud) {
  const m = model(b);
  const type = TYPE[c.type] || c.type;
  const rvKo = c.type === "answered_review" && (c.items || []).length === 1 ? koOf("crit:" + c.items[0].criterion_id) : "";
  const title = rvKo || String(c.title || "").replace(/^\[[^\]]+\]\s*/, "");
  const items = (c.items || []).map((it) => {
    const ko = aud === "patient" ? koOf("crit:" + it.criterion_id) : "";
    const no = trialNo(b, it.trial_id);
    const dec = latest(m, it.criterion_id);
    const done = dec && dec.status !== "UNKNOWN";
    return `<li>
      ${ko ? `<p>${esc(ko)} <span class="tag">번역</span></p><details class="orig"><summary>원문 보기</summary><p lang="en">${esc(it.criterion_text)}</p></details>` : `<p lang="en">${esc((it.criterion_text || "").slice(0, 220))}</p>`}
      <p class="item-meta">${no ? `<span>${esc(no)}</span>` : ""}${aud === "clinician" || !no ? `<span class="mono">${esc(it.criterion_id)}</span>` : ""}${done ? `<span class="tag">이미 판정됨</span>` : ""}</p></li>`;
  }).join("");
  const lastOf = (c.priority && c.priority.last_blocker_of) || [];
  const doneAns = S.state === "after" ? b.meta.answers.find((a) => a.card_id === c.card_id) : null;
  const foot = aud === "clinician" ? `<p class="card-id"><span class="mono">${esc(c.card_id)}</span>${c._part ? `<span class="mono">${esc(c._part)}</span>` : ""}</p>` : "";
  const one = (c.items || []).length === 1 ? c.items[0] : null;
  const koTitle = aud === "patient" && one ? koOf("crit:" + one.criterion_id) : "";
  const body = koTitle
    ? `<h3>${esc(title)}</h3><div class="rel-crit"><p class="rel-label">관련 기준 (${one.criterion_type === "exclusion" ? "제외" : "포함"})</p><p>${esc(koTitle)} <span class="tag">번역</span></p><details class="orig"><summary>원문 보기</summary><p lang="en">${esc(one.criterion_text)}</p></details></div><p class="item-meta">${trialNo(b, one.trial_id) ? `<span>${esc(trialNo(b, one.trial_id))}</span>` : `<span class="mono">${esc(one.criterion_id)}</span>`}${latest(m, one.criterion_id) && latest(m, one.criterion_id).status !== "UNKNOWN" ? `<span class="tag">이미 판정됨</span>` : ""}</p>`
    : `<h3>${esc(title)}${rvKo ? ` <span class="tag">번역</span>` : ""}</h3><ul class="items">${items}</ul>${(c.answer_docs || []).map((doc) => `<button type="button" class="linkish" data-doc="${esc(doc)}">받은 답 문서 <span class="mono">${esc(doc)}</span> 원문 보기</button>`).join("")}`;
  return `<div class="todo" id="card-${esc(c.card_id)}">
    <div class="todo-top"><span class="ttype">${esc(type)}</span>${lastOf.length ? `<span class="tag tag-key">마지막 확인 항목</span>` : ""}</div>
    ${body}
    ${doneAns ? usedHTML(doneAns, false) + typedHTML(doneAns) : ""}
    ${foot}</div>`;
}

/* 2차 판정에 실제로 쓴 정보(미리 실행한 답 문서)와, 시연 입력창에 넣은 내용을 따로 보인다 */
function usedHTML(a, withDoc) {
  const x = demoSplit(a.text || a.answer), nd = withDoc && S.bundles.after && S.bundles.after.meta.new_docs.find((n) => n.card_id === a.card_id);
  return `<div class="answer"><p class="ans-head"><span class="tag">2차 판정에 쓴 정보</span>${x.demo ? DEMO_TAG : ""}</p>
    <dl class="ans-dl"><div><dt>날짜</dt><dd class="mono">${esc(a.date || "-")}</dd></div><div><dt>내용</dt><dd lang="en">${esc(x.text)}</dd></div></dl>
    ${nd ? `<button type="button" class="linkish" data-doc="${esc(nd.doc_id)}">새 문서 <span class="mono">${esc(nd.doc_id)}</span> 원문 보기</button>` : ""}</div>`;
}
function typedDiff(a) {
  const t = S.typed[a.card_id];
  if (!t) return null;
  return t.date !== (a.date || "") || t.text.trim() !== demoSplit(a.text || a.answer).text.trim() ? t : null;
}
function typedHTML(a) {
  const t = typedDiff(a);
  return t ? `<div class="answer answer-typed"><p class="ans-head"><span class="tag">입력한 내용</span><span class="tag tag-moved">시연에서 판정에 쓰지 않았음</span></p>
    <dl class="ans-dl"><div><dt>날짜</dt><dd class="mono">${esc(t.date || "-")}</dd></div><div><dt>내용</dt><dd>${esc(t.text)}</dd></div></dl>
    <p class="af-note">시연은 API를 부르지 않아 입력 내용으로 다시 판정하지 않습니다. 위의 2차 판정은 미리 넣어 둔 정보로 실행한 결과입니다.</p></div>` : "";
}
/* 시연용 입력창: 입력은 받지만 API는 부르지 않고, 미리 실행한 2차 판정 결과를 불러온다. 2차 판정에 쓴 정보로 미리 채워 둔다. */
function answerForm(c, a, aud, label) {
  const id = "af-" + c.card_id.replace(/[^A-Za-z0-9]/g, "-") + "-" + aud;
  const asOf = S.bundles.before.meta.as_of;
  const t = S.typed[a.card_id];
  return `<form class="answer-form" data-replay="${esc(c.card_id)}" novalidate>
    <p class="af-h">${aud === "patient" ? "새 결과 알려 주기" : "새 정보 입력"}</p>
    ${label ? `<p class="af-for">${label}</p>` : ""}
    <label class="af-field" for="${id}-d"><span>날짜</span><input id="${id}-d" type="date" name="date" value="${esc(t ? t.date : a.date || "")}" max="${esc(asOf)}" required aria-describedby="${id}-dh"></label>
    <p class="af-hint" id="${id}-dh">기준일 <span class="mono">${esc(asOf)}</span>까지의 날짜만 넣을 수 있습니다.</p>
    <p class="af-err" id="${id}-de" role="alert" hidden></p>
    <label class="af-field" for="${id}-t"><span>내용</span><textarea id="${id}-t" name="text" rows="4" required>${esc(t ? t.text : demoSplit(a.text || a.answer).text)}</textarea></label>
    <button type="submit" class="btn btn-primary">입력하고 2차 판정 보기</button>
    <p class="af-note">시연용: 입력 내용과 관계없이 미리 실행한 2차 판정 결과를 보여 줍니다. 입력이 미리 채운 내용과 다르면 2차 판정 화면에 따로 표시합니다.</p>
  </form>`;
}

/* ---------- 내가 할 일 (환자 모드): 카드 데이터만으로 세 묶음 ----------
 * 1) 내가 답할 수 있는 질문: 행정 기준이 아닌 patient_question 중 answerable_by에 patient가 있는 것 → 예/아니오/잘 모르겠어요
 * 2) 의료진이 확인할 것: 나머지 환자용 카드(새 검사, 검사 결과 찾기, 기록 확인 등) + '잘 모르겠어요'로 답한 질문 → 목록과 복사 버튼
 * 3) 행정 조건: 한 줄
 * 질문 문장은 data/card_ko.json. 응답은 (카드 종류 + 기준 ID) 키로 저장하고, 판정은 바꾸지 않는다. */
const ANS = { yes: "예", no: "아니오", unsure: "잘 모르겠어요" };
const isAsk = (c) => c.type === "patient_question" && (c.items || []).length > 0 && (c.items || []).every((it) => (it.answerable_by || []).includes("patient"));
const respOf = (c) => { const R = myResp(); for (const it of c.items || []) if (R[rKey(c, it)]) return R[rKey(c, it)]; return null; };
function qMeta(b, c, withType) {
  const tids = [...new Set((c.items || []).map((it) => it.trial_id))];
  const types = [...new Set((c.items || []).map((it) => (it.criterion_type === "exclusion" ? "제외 조건" : "참여 조건")))];
  const last = ((c.priority && c.priority.last_blocker_of) || []).length;
  return `<ul class="q-meta" aria-label="항목 정보">${withType ? `<li class="ttype">${esc(TYPE[c.type] || c.type)}</li>` : ""}${tids.map((t) => `<li>${esc(trialNo(b, t) || "순위 밖 시험")}</li>`).join("")}${types.map((t) => `<li>${t}</li>`).join("")}${last ? `<li class="tag tag-key">마지막 확인 항목</li>` : ""}</ul>`;
}
function relCrit(c) {
  const its = c.items || [];
  return `<details class="orig"><summary>관련 조건 보기</summary>${its.map((it) => { const ko = koOf("crit:" + it.criterion_id); return `${ko ? `<p>${esc(ko)} <span class="tag">번역</span></p>` : ""}<p lang="en">${esc(it.criterion_text)}</p>`; }).join("")}</details>`;
}
function askHTML(b, c) {
  const r = respOf(c), rk = esc((c.items || []).map((it) => rKey(c, it)).join(","));
  const q = qOf(c.items[0]);
  return `<li class="todo q-card" id="card-${esc(c.card_id)}">
    <p class="q-text" id="q-${esc(c.card_id.replace(/[^A-Za-z0-9]/g, "-"))}"${q.ko ? "" : ' lang="en"'}>${esc(q.text)}</p>
    ${qMeta(b, c, false)}
    ${relCrit(c)}
    <div class="q-ans" role="group" aria-labelledby="q-${esc(c.card_id.replace(/[^A-Za-z0-9]/g, "-"))}"><div class="q-btns">${Object.keys(ANS).map((k) => `<button type="button" class="btn btn-ans${r && r.answer === k ? " on" : ""}" data-ans="${k}" data-rk="${rk}" aria-pressed="${!!(r && r.answer === k)}">${ANS[k]}</button>`).join("")}</div></div>
    ${r ? `<p class="q-done" role="status">답: ${ANS[r.answer]}. ${r.review === "ok" ? "의료진이 확인했습니다." : r.review === "more" ? "의료진이 추가 확인이 필요하다고 표시했습니다." : "의료진 확인을 기다리고 있습니다."}</p>` : ""}
  </li>`;
}
function checkLine(b, c) {
  const qs = (c.items || []).map(qOf), r = respOf(c);
  const line = `- ${[...new Set((c.items || []).map((it) => trialNo(b, it.trial_id) || it.trial_id))].join(", ")}: ${qs.map((q) => q.text).join(" / ")}${r && r.answer === "unsure" ? " (환자 답: 잘 모르겠어요)" : ""}`;
  return `<li class="chk" id="card-${esc(c.card_id)}" data-line="${esc(line)}">
    ${qs.map((q) => `<p class="chk-text"${q.ko ? "" : ' lang="en"'}>${esc(q.text)}</p>`).join("")}
    ${qMeta(b, c, !(r && r.answer === "unsure"))}
    ${r && r.answer === "unsure" ? `<p class="chk-unsure"><span class="tag">질문에 '잘 모르겠어요'로 답함</span><button type="button" class="linkish" data-unans="${esc((c.items || []).map((it) => rKey(c, it)).join(","))}">다시 답하기</button></p>` : ""}
  </li>`;
}
function todoHTML(b, d) {
  const pc = b.cards.filter((c) => c.audience === "patient");
  const admin = pc.filter((c) => isAdminCard(b, c)), rest = pc.filter((c) => !admin.includes(c));
  const asks = rest.filter((c) => isAsk(c) && !(respOf(c) && respOf(c).answer === "unsure"));
  const checks = rest.filter((c) => !asks.includes(c));
  let h = `<section class="tgroup" aria-labelledby="tg-ask"><h3 id="tg-ask">내가 답할 수 있는 질문 <span class="num">${asks.length}</span></h3>`;
  h += asks.length ? `<p class="tg-note">답은 의료진이 확인합니다. 시연에서는 답이 판정을 바꾸지 않습니다.</p><ul class="todos">${asks.map((c) => askHTML(b, c)).join("")}</ul>` : `<p class="empty">지금 답할 질문이 없습니다.</p>`;
  h += `</section><section class="tgroup" aria-labelledby="tg-chk"><h3 id="tg-chk">의료진이 확인할 것 <span class="num">${checks.length}</span></h3>`;
  if (checks.length) h += `<ul class="chk-list">${checks.map((c) => checkLine(b, c)).join("")}</ul><div class="copy-row"><button type="button" class="btn" data-copy>의료진에게 보여 줄 목록 복사</button><p class="copy-msg" role="status"></p></div>`;
  else h += `<p class="empty">의료진이 확인할 항목이 없습니다.</p>`;
  const pend = S.state === "before" && S.bundles.after ? S.bundles.after.meta.answers.map((a) => [pc.find((c) => c.card_id === a.card_id), a]).filter(([c]) => c) : [];
  h += pend.map(([c, a]) => answerForm(c, a, "patient", esc(qOf(c.items[0]).text))).join("");
  if (d) {
    const g = d.goneCards.filter((c) => c.audience === "patient");
    if (g.length) h += `<details class="fold" open><summary>2차 판정에서 확인된 항목 ${g.length}개</summary><ul class="gone">${g.map((c) => `<li>${esc((c.items || []).map((it) => qOf(it).text).join(" / "))}</li>`).join("")}</ul></details>`;
  }
  h += `</section>`;
  if (admin.length) h += `<section class="tgroup" aria-labelledby="tg-adm"><h3 id="tg-adm" class="visually-hidden">행정 조건</h3><p class="admin-note">연구기관이 확인하는 행정 조건 <span class="mono">${admin.length}</span>개는 여기에 표시하지 않습니다. 동의서, 보험, 법적 상태 같은 조건은 연구 담당자가 확인합니다.</p></section>`;
  return h;
}

/* ---------- 환자 응답 확인 대기 (의료진 모드 맨 위) ---------- */
function findItem(k) {
  const [type, cid] = k.split("|");
  for (const st of [S.state, "before", "after"]) {
    const bb = S.bundles[st];
    if (!bb) continue;
    for (const c of bb.cards) if (c.type === type) for (const it of c.items || []) if (it.criterion_id === cid) return { c, it, bb };
  }
  return null;
}
function respTable() {
  const R = myResp(), keys = Object.keys(R).filter((k) => R[k] && R[k].answer);
  const pending = keys.filter((k) => !R[k].review).length;
  const rows = keys.map((k) => {
    const f = findItem(k);
    if (!f) return "";
    const { it, bb } = f, r = R[k], ex = it.criterion_type === "exclusion";
    return `<tr>
      <td data-label="시험"><span>${esc(trialNo(bb, it.trial_id) || "순위 밖 시험")}</span><br><span class="mono">${esc(it.trial_id)}</span></td>
      <td data-label="조건"><span class="mono">${esc(it.criterion_id.replace(it.trial_id + "-", ""))}</span><br><span>${ex ? "제외 조건" : "참여 조건"}</span></td>
      <td class="rt-q" data-label="질문">${esc(qOf(it).text)}</td>
      <td data-label="환자 응답"><span class="rt-ans">${ANS[r.answer]}</span>${ex ? `<br><span class="tag tag-moved">의료진 확인 필요</span>` : ""}</td>
      <td data-label="확인"><div class="seg seg-sm" role="group" aria-label="${esc(it.criterion_id)} 확인">${[["ok", "확인 완료"], ["more", "추가 확인 필요"]].map(([v, t]) => `<button type="button" data-review="${v}" data-rk="${esc(k)}" class="${r.review === v ? "on" : ""}" aria-pressed="${r.review === v}">${t}</button>`).join("")}</div></td></tr>`;
  }).join("");
  return `<section class="resp" aria-labelledby="resp-h"><div class="resp-head"><h2 id="resp-h">환자 응답 확인 대기 <span class="num">${pending}</span>건</h2>
    <p class="meta">시연에서는 환자 응답이 판정을 바꾸지 않습니다. 판정이 바뀌는 과정은 '새 정보 입력 → 2차 판정'으로 보여 줍니다.</p></div>
    ${keys.length ? `<div class="table-wrap"><table class="crit resp-t"><thead><tr><th scope="col">시험</th><th scope="col">조건</th><th scope="col">질문</th><th scope="col">환자 응답</th><th scope="col">확인</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="empty">아직 올라온 환자 응답이 없습니다. 환자 모드의 '내가 답할 수 있는 질문'에서 답하면 여기에 올라옵니다.</p>`}</section>`;
}

function cardsHTML(b, d, pred, aud) {
  const all = b.cards.filter(pred);
  const admin = aud === "patient" ? all.filter((c) => isAdminCard(b, c)) : [];
  const list = all.filter((c) => !admin.includes(c));
  const isSafety = (c) => (c.priority && c.priority.safety_check_of && c.priority.safety_check_of.length) && !(c.priority.blocking_trials || []).length;
  const main = list.filter((c) => !isSafety(c)), safety = list.filter(isSafety);
  let h = main.length ? `<div class="todos">${main.map((c) => cardHTML(c, b, d, aud)).join("")}</div>` : `<p class="empty">지금 먼저 할 일은 없습니다.</p>`;
  if (safety.length) h += `<details class="fold"><summary>확인 권장 ${safety.length}개 (시험을 막지 않는 안전 확인 질문)</summary><div class="todos">${safety.map((c) => cardHTML(c, b, d, aud)).join("")}</div></details>`;
  if (admin.length) h += `<p class="admin-note">연구기관이 확인하는 행정 조건 <span class="mono">${admin.length}</span>개는 여기에 표시하지 않습니다. 동의서, 보험, 법적 상태 같은 조건은 연구 담당자가 확인합니다.</p>`;
  if (d) {
    const g = d.goneCards.filter(pred), lost = d.lostItems.filter((x) => pred(x.card));
    if (g.length) h += `<details class="fold" open><summary>2차 판정에서 해결된 카드 ${g.length}개</summary><ul class="gone">${g.map((c) => `<li>${esc(c.title)}</li>`).join("")}</ul></details>`;
    if (lost.length && aud === "clinician") h += `<div class="lost"><p class="lost-h">카드 없이 남은 기준 <span class="mono">${lost.length}</span>개</p><p class="meta">기준은 아직 판정되지 않았는데 2차 판정 카드에서 빠졌습니다. 에이전트 5 확인이 필요합니다.</p><ul>${lost.map(({ card, item }) => `<li><button type="button" class="linkish mono" data-refs="${esc((latest(model(b), item.criterion_id) || {}).id || "crit:" + item.criterion_id)}">${esc(item.criterion_id)}</button> <span class="meta-inline">${esc(TYPE[card.type] || card.type)}</span></li>`).join("")}</ul></div>`;
  }
  return h;
}

function evChips(m, dec) {
  const chips = [];
  for (const [rel, src] of m.inn.get(dec.id) || []) {
    const n = m.nodes.get(src);
    if (!n) continue;
    if (n.kind === "evidence") {
      const cls = rel === "insufficient_for" ? "ins" : rel === "expired_for" ? "exp" : rel === "answers" ? "ans" : "";
      chips.push(`<button type="button" class="chip ${cls}" data-refs="${esc(n.id)}" title="${esc(REL[rel] || rel)}"><span>${esc(n.term || n.concept)}</span><span class="chip-v">${esc(n.value)}</span>${n.observed_date ? `<span class="mono">${esc(n.observed_date)}</span>` : ""}</button>`);
    } else if (n.kind === "calculation") {
      chips.push(`<button type="button" class="chip calc" data-refs="${esc(n.id)}"><span>계산</span></button>`);
    }
  }
  return chips.join("");
}

function clinicianView(b, d) {
  const m = model(b), g = groupSentences(b.briefing.clinician);
  const ranked = b.ranking.items.map((i) => i.trial_id);
  const near = (b.ranking.near_miss || []).map((x) => x.trial_id);
  const all = b.graph.nodes.filter((n) => n.kind === "trial_decision").map((n) => n.id.slice(6));
  const order = [...ranked, ...near.filter((t) => !ranked.includes(t)), ...all.filter((t) => !ranked.includes(t) && !near.includes(t))];
  if (!S.trialSel || !order.includes(S.trialSel)) S.trialSel = order[0];
  const tl = order.map((tid) => {
    const lab = m.nodes.get("label:" + tid), r = ranked.indexOf(tid);
    const ch = d && d.labels.find((x) => x.trial_id === tid);
    const sub = r >= 0 ? `${r + 1}순위` : near.includes(tid) ? "near-miss (FAIL 1개)" : "순위 밖";
    const t = tally(b, tid);
    return `<button type="button" data-tsel="${tid}" class="tl-item${tid === S.trialSel ? " on" : ""}" aria-current="${tid === S.trialSel}">
      <span class="tl-row">${labelBadge(lab && lab.label)}${ch ? `<span class="tag tag-moved">바뀜</span>` : ""}</span>
      <span class="tl-row"><span class="mono">${esc(tid)}</span><span class="tl-sub">${esc(sub)}</span></span>
      <span class="tl-row tl-mini">${ORDER.filter((k) => t[k] && k !== "pass").map((k) => `<span class="lg lg-${k}">${icon(k)}<span class="mono">${t[k]}</span></span>`).join("")}</span></button>`;
  }).join("");
  const tid = S.trialSel, trial = m.nodes.get("trial:" + tid), lab = m.nodes.get("label:" + tid), rec = b.trials[tid] || {};
  const rk = b.ranking.items.find((i) => i.trial_id === tid);
  const grp = g.trials.filter((t) => t.trial_id === tid).flatMap((t) => t.sents);
  const kr = (rec.sites || []).filter((s) => /korea/i.test(s.country || "")).length;
  const titleKo = koOf("trial:" + tid);
  const crits = m.criteria.get(tid) || [];
  const rowOf = (cr) => {
    const cid = critOf(cr.id), hist = m.decs.get(cid) || [], dec = hist[hist.length - 1];
    const si = statusInfo(dec, cr.type), chg = d && d.changed.get(cid);
    if (S.filter !== "all" && si.key !== S.filter) return "";
    const ko = koOf(cr.id);
    const text = S.lang === "ko" && ko ? `${esc(ko)} <span class="tag">번역</span>` : esc(cr.text);
    const hx = hist.length > 1 ? `<details class="hist"><summary>변경 기록 ${hist.length}개</summary><ol>${hist.map((h) => `<li><span class="mono">r${h.round}</span> <span>${esc(h.by)}</span> ${pill(statusInfo(h, cr.type), "st-sm")}</li>`).join("")}</ol></details>` : "";
    const was = chg && chg.before ? `<div class="was">${pill(statusInfo(chg.before, cr.type), "st-sm st-old")}<svg width="16" height="10" viewBox="0 0 16 10" aria-hidden="true"><path d="M1 5h12M9.5 1.5L13 5 9.5 8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></div><p class="why-moved">${d.target.has(cid) ? "새 정보 대상 기준" : "2차 판정에서 함께 바뀜"}</p>` : "";
    const cards = m.cardsByCrit.get(tid + "|" + cid) || [];
    return `<tr class="${chg ? "changed" : ""}" data-refs="${esc(dec ? dec.id : cr.id)}" tabindex="0">
      <td class="c-id"><span class="mono">${esc(cid.replace(tid + "-", ""))}</span></td>
      <td class="c-text">${text}${cr.administrative ? ` <span class="tag">행정</span>` : ""}${cr.cohort ? ` <span class="tag">${esc(cr.cohort)}</span>` : ""}</td>
      <td class="c-st">${was}${pill(si)}${dec ? `<p class="how"><span class="mono">${esc(dec.reason || "")}</span><span class="mono">${esc(dec.judged_by)} r${dec.round}</span></p>` : ""}${hx}</td>
      <td class="c-ev"><div class="chips">${dec ? evChips(m, dec) : ""}</div>${dec && dec.missing_fact ? `<p class="need"><span class="tag">필요</span> ${esc(dec.missing_fact)}</p>` : ""}${cards.length ? `<button type="button" class="card-link" data-cards="${esc(cards.map((c) => c.card_id).join(","))}">확인 요청 ${cards.length}</button>` : ""}</td></tr>`;
  };
  const section = (type, name) => {
    const cs = crits.filter((c) => c.type === type), rows = cs.map(rowOf).join("");
    return cs.length ? `<tbody><tr class="group"><th colspan="4" scope="colgroup">${name} 기준 <span class="mono">${cs.length}</span></th></tr>${rows || `<tr><td colspan="4" class="empty">이 상태인 ${name} 기준이 없습니다.</td></tr>`}</tbody>` : "";
  };
  const hasKo = crits.some((c) => koOf(c.id));
  const openCrit = ranked.reduce((n, t) => n + (m.criteria.get(t) || []).filter((cr) => { const x = latest(m, critOf(cr.id)); return x && x.status === "UNKNOWN"; }).length, 0);
  const clinCards = b.cards.length;
  const hero = `<section class="hero hero-clin"><h2>순위 시험 <span class="num">${ranked.length}</span>건, 확인할 기준 <span class="num">${openCrit}</span>개</h2><p class="hero-sub"><span>확인 요청 카드 <span class="num">${clinCards}</span>장</span><span>순위 밖 시험 <span class="num">${order.length - ranked.length}</span>건</span></p></section>`;
  // 시연용 새 정보 입력: 시험 선택과 상관없이 상단에 보인다 (1차 판정 + 미리 만든 2차 판정이 있을 때만)
  const pend = S.state === "before" && S.bundles.after ? S.bundles.after.meta.answers.map((a) => [b.cards.find((c) => c.card_id === a.card_id), a]).filter(([c]) => c) : [];
  const input = pend.length ? `<section class="clin-input" aria-label="새 정보 입력">${pend.map(([c, a]) => {
    const tids = [...new Set((c.items || []).map((it) => it.trial_id))];
    const title = String(c.title || "").replace(/^\[[^\]]+\]\s*/, "");
    return `<div class="ci-card"><div class="ci-head"><span class="ttype">${esc(TYPE[c.type] || c.type)}</span><h3>${esc(title)}</h3><ul class="q-meta">${tids.map((t) => `<li>${esc(trialNo(b, t) || "순위 밖 시험")}</li><li class="mono">${esc(t)}</li>`).join("")}<li class="mono">${esc(c.card_id)}</li></ul></div>${answerForm(c, a, "clinician")}</div>`;
  }).join("")}</section>` : "";
  return respTable() + hero + input + `<div class="clin">
    <nav class="tlist" aria-label="시험 목록"><h2 class="tlist-h">시험</h2>${tl}</nav>
    <div class="clin-main">
      <header class="trial-sheet">
        <div class="trial-top">${labelBadge(lab && lab.label)}<span class="mono nct">${esc(tid)}</span></div>
        <h2>${esc(trial && trial.title)}</h2>
        ${titleKo ? `<p class="title-ko">${esc(titleKo)} <span class="tag">번역</span></p>` : ""}
        <dl class="facts-dl">
          <div><dt>단계</dt><dd>${esc((rec.phases || []).join(", ") || "-")}</dd></div>
          <div><dt>모집 상태</dt><dd>${esc(rec.overall_status || "-")}</dd></div>
          <div><dt>모집 상태 확인</dt><dd><span class="mono">${esc(rec.status_verified || "-")}</span>${rk && rk.stale ? ` <span class="tag">${rk.months_since_verified}개월 전</span>` : ""}</dd></div>
          <div><dt>국내 기관</dt><dd><span class="mono">${kr}</span></dd></div>
          ${lab && lab.why && lab.why.length ? `<div class="wide"><dt>판정 이유</dt><dd class="why">${lab.why.map((w) => whyHTML(m, w, tid)).join("")}</dd></div>` : ""}
        </dl>
        ${strip(b, tid, d, { filter: true })}
      </header>
      <div class="table-tools">
        <h3>기준 판정</h3>
        ${hasKo ? `<div class="seg seg-sm" role="group" aria-label="기준 글"><button type="button" data-lang="orig" class="${S.lang === "orig" ? "on" : ""}" aria-pressed="${S.lang === "orig"}">원문</button><button type="button" data-lang="ko" class="${S.lang === "ko" ? "on" : ""}" aria-pressed="${S.lang === "ko"}">번역</button></div>` : ""}
      </div>
      <div class="table-wrap"><table class="crit">
        <thead><tr><th scope="col">기준</th><th scope="col">내용</th><th scope="col">판정</th><th scope="col">근거와 필요한 정보</th></tr></thead>
        ${section("inclusion", "포함")}${section("exclusion", "제외")}
      </table></div>
      <details class="fold brief"><summary>의료진용 브리핑 문장 ${grp.length}개</summary>${grp.length ? `<div class="brief-body">${grp.map((s) => `<p>${sentHTML(s, d, "clinician", b)}</p>`).join("")}</div>` : `<p class="empty">이 시험은 의료진용 브리핑에 포함되지 않았습니다.</p>`}</details>
      <section class="clin-cards"><h3>확인 요청 카드 (이 시험)</h3>${cardsHTML(b, d, (c) => (c.items || []).some((it) => it.trial_id === tid), "clinician")}</section>
      ${g.pre.length || g.post.length ? `<div class="brief-meta">${[...g.pre, ...g.post].map((s) => `<p>${sentHTML(s, d, "clinician", b)}</p>`).join("")}</div>` : ""}
    </div></div>`;
}

function whyHTML(m, w, tid) {
  const mm = String(w).match(/^([A-Z]+)(?:\/([A-Z]+))?\s+(\S+)$/);
  if (!mm) return `<span class="mono">${esc(w)}</span>`;
  const [, status, reason, cid] = mm;
  const cr = m.nodes.get("crit:" + cid), dec = latest(m, cid);
  return `<span class="why-item">${pill(statusInfo({ status, reason }, cr && cr.type), "st-sm")}<button type="button" class="linkish mono" data-refs="${esc(dec ? dec.id : "crit:" + cid)}">${esc(cid.replace(tid + "-", ""))}</button></span>`;
}

function renderUpdate(d) {
  const el = $("#update-summary");
  if (!d) { el.innerHTML = ""; return; }
  const a = S.bundles.after, ma = model(a), n = a.meta.answers.length;
  if (S.view === "patient") {
    // 입력 여부와 상관없이 같은 문장: 2차 판정은 미리 넣어 둔 정보로 실행한 결과다
    const given = a.meta.answers.map((x) => usedHTML(x, true) + typedHTML(x)).join("");
    el.innerHTML = `<div class="update-in"><p class="after-note">1차 판정 뒤 새 정보 <span class="num">${n}</span>건을 넣고 다시 판정한 2차 판정 결과입니다. 근거 지도에서 바뀐 조건과 바뀐 문장은 바탕색으로 표시했습니다. 전체 목록은 의료진 모드에서 볼 수 있습니다.</p><div class="ans-row">${given}</div></div>`; return; }
  const ans = a.meta.answers.map((x) => {
    const card = S.bundles.before.cards.find((c) => c.card_id === x.card_id);
    const it = card && card.items && card.items[0];
    return `<li><p>${esc(it ? qOf(it).text : card ? card.title : x.card_id)}</p>${usedHTML(x, true)}${typedHTML(x)}</li>`;
  }).join("");
  const line = (cid, c) => {
    const crit = ma.nodes.get("crit:" + cid);
    return `<li><button type="button" class="linkish mono" data-refs="${esc(c.after.id)}">${esc(cid)}</button><span class="pair">${pill(statusInfo(c.before, crit && crit.type), "st-sm st-old")}<svg width="16" height="10" viewBox="0 0 16 10" aria-hidden="true"><path d="M1 5h12M9.5 1.5L13 5 9.5 8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>${pill(statusInfo(c.after, crit && crit.type), "st-sm")}</span></li>`;
  };
  const tgt = [...d.changed].filter(([cid]) => d.target.has(cid)), other = [...d.changed].filter(([cid]) => !d.target.has(cid));
  const unchangedTarget = [...d.target].filter((cid) => !d.changed.has(cid));
  el.innerHTML = `<section class="update" aria-labelledby="upd-h"><div class="update-in">
    <h2 id="upd-h">2차 판정: 새 정보 <span class="num">${n}</span>건 → 에이전트 2 재추출 → 에이전트 3 재판정</h2>
    <ol class="flow">
      <li><h3>2차 판정에 쓴 새 정보</h3><ul>${ans}</ul></li>
      <li><h3>새 정보 대상 기준</h3><ul>${tgt.map(([c, x]) => line(c, x)).join("")}${unchangedTarget.map((c) => `<li><span class="mono">${esc(c)}</span> 변화 없음</li>`).join("")}</ul></li>
      <li><h3>2차 판정에서 함께 바뀐 기준 <span class="mono">${other.length}</span>개</h3><ul>${other.map(([c, x]) => line(c, x)).join("")}</ul></li>
      <li><h3>시험 판정 (1차 → 2차)</h3><ul>${d.labels.length ? d.labels.map((l) => `<li><span class="mono">${esc(l.trial_id)}</span><span class="pair">${labelBadge(l.before)}<svg width="16" height="10" viewBox="0 0 16 10" aria-hidden="true"><path d="M1 5h12M9.5 1.5L13 5 9.5 8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>${labelBadge(l.after)}</span></li>`).join("") : "<li>변화 없음</li>"}</ul>
        <h3>카드 (1차 → 2차)</h3><ul><li><p><span class="mono">${S.bundles.before.cards.length}</span>장 → <span class="mono">${a.cards.length}</span>장</p></li><li><dl class="cnt-dl"><div><dt>2차 판정에서 해결</dt><dd class="mono">${d.goneCards.length}</dd></div><div><dt>번호만 바뀜</dt><dd class="mono">${d.renumbered.length}</dd></div><div><dt>새로 생김</dt><dd class="mono">${d.newCards.length}</dd></div>${d.reviewCards.length ? `<div><dt>답 받음·의료진 확인 중</dt><dd class="mono">${d.reviewCards.length}</dd></div>` : ""}</dl></li>${d.lostItems.length ? `<li><p class="lost-inline">카드 없이 남은 기준 <span class="mono">${d.lostItems.length}</span>개 (에이전트 5 확인 필요)</p></li>` : ""}</ul></li>
    </ol></div></section>`;
}


/* ---------- evidence map (v3): 환자 모드 기본 화면 ----------
 * 그래프를 환자가 읽을 수 있게 세 칸으로 줄여 그린다: 내 기록(원문 문서) → 시험 조건 → 시험 결론.
 * 조건 묶음은 판정 상태로만 나눈다(새 문장 없음). 조건 글은 ko.json 번역, 없으면 원문.
 * 선: 문서 → 조건은 근거 엣지 종류(supports 실선, insufficient_for 점선, expired_for 주황), 묶음 → 결론은 묶음 상태 색. */
const GROUPS = [
  { key: "key", name: "판정을 정한 조건", open: true },
  { key: "fail", name: "맞지 않는 조건", open: true },
  { key: "open", name: "아직 확인이 필요한 조건", open: true },
  { key: "exmiss", name: "기록에 없어 확인하지 못한 제외 조건", open: false },
  { key: "pass", name: "맞는 조건", open: false },
  { key: "admin", name: "연구기관이 확인하는 행정 조건", open: false },
];
function trialOrder(b) {
  const ranked = b.ranking.ranking || [];
  const all = b.graph.nodes.filter((n) => n.kind === "trial_decision").map((n) => n.id.slice(6));
  return [...ranked.filter((t) => all.includes(t)), ...all.filter((t) => !ranked.includes(t))];
}
function parseWhy(w) { const mm = String(w).match(/^([A-Z]+)(?:\/([A-Z]+))?\s+(\S+)$/); return mm ? mm[3] : null; }
function docsOfDec(m, dec) {
  const out = new Map();     // doc_id -> rel (expired_for > insufficient_for > supports)
  const rank = { supports: 1, insufficient_for: 2, expired_for: 3 };
  for (const [rel, s] of m.inn.get(dec.id) || []) {
    const ev = m.nodes.get(s);
    if (!ev || ev.kind !== "evidence" || !rank[rel]) continue;
    for (const [r2, srcId] of m.out.get(ev.id) || []) {
      if (r2 !== "derived_from") continue;
      const src = m.nodes.get(srcId);
      if (!src) continue;
      const was = out.get(src.doc_id);
      if (!was || rank[rel] > rank[was]) out.set(src.doc_id, rel);
    }
  }
  return out;
}
function demoTargets() {
  const a = S.bundles.after, b0 = S.bundles.before, out = new Set();
  if (!a || !b0) return out;
  for (const ans of a.meta.answers || []) {
    const c = b0.cards.find((x) => x.card_id === ans.card_id);
    for (const it of (c && c.items) || []) out.add(it.criterion_id);
  }
  return out;
}
function mapModel(b, tid) {
  const m = model(b), lab = m.nodes.get("label:" + tid);
  const key = new Set((lab && lab.why || []).map(parseWhy).filter(Boolean));
  const groups = Object.fromEntries(GROUPS.map((g) => [g.key, []]));
  const docs = new Map();
  for (const cr of m.criteria.get(tid) || []) {
    const cid = critOf(cr.id), dec = latest(m, cid), si = statusInfo(dec, cr.type);
    const ds = dec ? docsOfDec(m, dec) : new Map();
    const item = { cr, cid, dec, si, docs: ds };
    let g;
    // 시연에서 새 정보를 넣는 대상 기준(2차 판정 답 카드의 기준)은 1차·2차 모두 '아직 확인이 필요한 조건'에 둔다.
    // 같은 자리에서 상태만 바뀌어야 '확인 필요 → 새 정보 → 바뀐 결과'로 읽힌다 (1차에서는 시험 판정 이유에 있어도)
    if (demoTargets().has(cid)) g = "open";
    else if (key.has(cid)) g = "key";
    else if (cr.administrative) g = "admin";
    else if (si.key === "fail") g = "fail";
    else if (si.key === "pass") g = "pass";
    else if (cr.type === "exclusion" && si.key === "missing") g = "exmiss";
    else g = "open";
    groups[g].push(item);
    for (const [doc] of ds) docs.set(doc, (docs.get(doc) || 0) + 1);
  }
  return { lab, groups, docs };
}

/* 고정 설명(rule) 문장은 '더 보기'에 접되, 국내 모집 기관 없음 안내는 펼쳐 둠 */
const foldRule = (s) => s.kind === "rule" && !(s.refs || []).includes("rule:no_kr_site");

function trialTabs(b, d, order) {
  const m = model(b);
  return `<div class="ttabs" role="tablist" aria-label="시험 고르기">${order.map((tid) => {
    const lab = m.nodes.get("label:" + tid), on = tid === S.mapTrial;
    const ch = d && d.labels.find((x) => x.trial_id === tid);
    const no = trialNo(b, tid) || "순위 밖 시험";
    return `<button type="button" role="tab" class="ttab${on ? " on" : ""}" aria-selected="${on}" data-mtrial="${esc(tid)}">
      <span class="ttab-top">${labelBadge(lab && lab.label)}${ch ? `<span class="tag tag-moved">바뀜</span>` : ""}</span>
      <span class="ttab-no">${esc(no)}</span>
      <span class="ttab-id mono">${esc(tid)}</span></button>`;
  }).join("")}</div>`;
}

function mapNode(b, d, it) {
  const m = model(b);
  const ko = koOf(it.cr.id);
  const ch = d && d.changed.get(it.cid);
  const cards = (m.cardsByCrit.get(it.dec ? it.dec.trial_id + "|" + it.cid : "") || []).filter((c) => c.audience === "patient" && !isAdminCard(b, c));
  // 환자 화면: 내부 경고('카드 없이 남음')는 보이지 않는다. 결과를 보낸 기준이 아직 미확인이면 확인 중임을 알린다
  const review = d && it.si.key !== "pass" && it.si.key !== "fail" && (d.reviewed.has(it.cid) || d.target.has(it.cid));
  const docChips = [...it.docs].map(([doc, rel]) => {
    const x = b.patient.documents.find((y) => y.doc_id === doc);
    return x ? `<span class="mini-doc rel-${rel}">${esc(DOC_KO[x.type] || x.type)} <span class="num">${esc(x.date)}</span></span>` : "";
  }).join("");
  const was = ch && ch.before ? `<span class="mn-was">${pill(statusInfo(ch.before, it.cr.type), "st-sm st-old")}<svg width="14" height="10" viewBox="0 0 16 10" aria-hidden="true"><path d="M1 5h12M9.5 1.5L13 5 9.5 8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></span>` : "";
  return `<li><div class="mnode${ch ? " moved" : ""}" data-k="c:${esc(it.cid)}">
    <button type="button" class="mn-main" data-refs="${esc(it.dec ? it.dec.id : it.cr.id)}" aria-label="근거 보기: ${esc(ko || it.cr.text)}, ${esc(it.si.text)}">
    <span class="mn-st">${was}${pill(it.si, "st-sm")}${review ? `<span class="tag tag-key">새 결과 받음 · 의료진 확인 중</span>` : ""}<span class="mn-type">${it.cr.type === "exclusion" ? "제외 조건" : "참여 조건"}</span>${ch ? `<span class="tag tag-moved">${d.target.has(it.cid) ? "2차 판정에서 바뀜" : "2차 판정에서 함께 바뀜"}</span>` : ""}</span>
    <span class="mn-text"${ko ? "" : ' lang="en"'}>${esc(ko || it.cr.text)}</span>
    ${docChips ? `<span class="mn-docs">${docChips}</span>` : ""}</button>
    ${cards.length ? `<button type="button" class="card-link" data-cards="${esc(cards.map((c) => c.card_id).join(","))}">할 일 ${cards.length}</button>` : ""}
  </div></li>`;
}

function evidenceMap(b, d, tid) {
  const m = model(b), mm = mapModel(b, tid), rec = b.trials[tid] || {};
  const rk = b.ranking.items.find((i) => i.trial_id === tid);
  const kr = (rec.sites || []).filter((s) => /korea/i.test(s.country || "")).length;
  const ch = d && d.labels.find((x) => x.trial_id === tid);
  const sents = groupSentences(b.briefing.patient).trials.filter((t) => t.trial_id === tid).flatMap((t) => t.sents);
  const head = sents[0];
  const docs = [...mm.docs.keys()].map((id) => b.patient.documents.find((x) => x.doc_id === id)).filter(Boolean).sort((x, y) => (x.date < y.date ? 1 : -1));
  const cnt = (k) => mm.groups[k].length;
  const t = tally(b, tid);
  const legend = ORDER.filter((k) => t[k]).map((k) => `<span class="lg lg-${k}">${icon(k)}<span>${SHORT[k]}</span><span class="mono">${t[k]}</span></span>`).join("");
  // links (keys resolved to visible elements when drawn)
  const links = [];
  for (const g of GROUPS) for (const it of mm.groups[g.key]) for (const [doc, rel] of it.docs) links.push({ a: "d:" + doc, b: "c:" + it.cid, g: "g:" + g.key, rel });
  for (const g of GROUPS) if (cnt(g.key)) links.push({ a: "g:" + g.key, b: "t", rel: "grp-" + g.key });
  S.mapLinks = links;

  const groupHTML = (g) => {
    if (!cnt(g.key)) return "";
    const inner = `<ul class="mlist">${mm.groups[g.key].map((it) => mapNode(b, d, it)).join("")}</ul>`;
    const changedIn = d ? mm.groups[g.key].filter((it) => d.changed.has(it.cid)).length : 0;
    const head = `<span class="mg-name">${esc(g.name)}</span><span class="mono mg-n">${cnt(g.key)}</span>${changedIn ? `<span class="tag tag-moved">바뀜 ${changedIn}</span>` : ""}`;
    const open = g.open || (g.key === "pass" && !cnt("key") && !cnt("fail"));   // 조건 맞음: 맞는 조건이 곧 이유
    // 모든 묶음을 접을 수 있게: 처음 펼침 여부만 open/바뀜으로 정한다
    return `<details class="mgroup mg-${g.key}" data-k="g:${g.key}"${open || changedIn ? " open" : ""}><summary class="mg-head">${head}</summary>${inner}</details>`;
  };
  return `<section class="emap-wrap" aria-labelledby="emap-h">
    <div class="emap-head"><h2 id="emap-h">판정 근거</h2>
      ${(() => { const ko = koOf("trial:" + tid), en = (b.trials[tid] || {}).title || ""; return `<p class="emap-trial">${ko ? `${esc(ko)} <span class="tag">번역</span>` : `<span lang="en">${esc(en)}</span>`}</p>`; })()}
      <p class="emap-note">내 기록 <span class="num">${docs.length}</span>개가 이 시험의 조건 <span class="num">${(m.criteria.get(tid) || []).length}</span>개와 어떻게 이어지는지 보여 줍니다. 조건 문장은 기계 번역이며, 누르면 원문과 근거가 열립니다.</p></div>
    <div class="emap" id="emap">
      <svg class="links" aria-hidden="true"></svg>
      <div class="mcol mcol-docs"><h3 class="mcol-h">내 기록</h3>
        ${docs.length ? `<ul class="mlist">${docs.map((x) => `<li><button type="button" class="mdoc" data-k="d:${esc(x.doc_id)}" data-doc="${esc(x.doc_id)}"><span class="doc-type">${esc(DOC_KO[x.type] || x.type)}</span><span class="num">${esc(x.date)}</span><span class="mdoc-n">조건 <span class="num">${mm.docs.get(x.doc_id)}</span>개</span></button></li>`).join("")}</ul>` : `<p class="empty">이 시험 판정에 쓴 기록이 없습니다.</p>`}
        <ul class="mlegend" aria-label="선 모양"><li><span class="ln ln-supports"></span>뒷받침</li><li><span class="ln ln-insufficient_for"></span>근거 부족</li><li><span class="ln ln-expired_for"></span>기간 지남</li></ul>
      </div>
      <div class="mcol mcol-crit"><h3 class="mcol-h">시험 조건</h3>${GROUPS.map(groupHTML).join("")}</div>
      <div class="mcol mcol-end"><h3 class="mcol-h">결론</h3>
        <div class="mend" data-k="t">
          <div class="mend-top">${ch ? `${labelBadge(ch.before)}<svg width="16" height="10" viewBox="0 0 16 10" aria-hidden="true"><path d="M1 5h12M9.5 1.5L13 5 9.5 8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>` : ""}${labelBadge(mm.lab && mm.lab.label)}</div>
          <p class="mend-no">${esc(trialNo(b, tid) || "순위 밖 시험")} <span class="mono nct">${esc(tid)}</span></p>
          ${head ? `<p class="mend-sent">${sentHTML(head, d, "patient", b)}</p>` : ""}
          <div class="legend">${legend}</div>
          <dl class="mend-dl"><div><dt>국내 모집 기관</dt><dd><span class="num">${kr}</span>곳</dd></div>${rk && rk.stale ? `<div><dt>모집 상태 확인</dt><dd><span class="num">${rk.months_since_verified}</span>개월 전</dd></div>` : ""}</dl>
        </div>
      </div>
    </div>
    ${sents.length > 1 ? (() => { const rest = sents.slice(1), facts = rest.filter((s) => !foldRule(s)), rules = rest.filter(foldRule);
      return `<div class="emap-more">${facts.length ? `<div class="facts">${facts.map((s) => `<p>${sentHTML(s, d, "patient", b)}</p>`).join("")}</div>` : ""}${rules.length ? `<details class="fold"><summary>이 시험에 대해 더 보기</summary><div class="facts">${rules.map((s) => `<p>${sentHTML(s, d, "patient", b)}</p>`).join("")}</div></details>` : ""}</div>`; })() : ""}
  </section>`;
}

/* lines: drawn after layout, redrawn on resize and when a group opens */
function drawMap() {
  const map = document.getElementById("emap");
  if (!map) return;
  const svg = map.querySelector("svg.links");
  if (getComputedStyle(svg).display === "none") return;
  const r0 = map.getBoundingClientRect();
  svg.setAttribute("width", map.clientWidth); svg.setAttribute("height", map.clientHeight);
  svg.setAttribute("viewBox", `0 0 ${map.clientWidth} ${map.clientHeight}`);
  const vis = (k) => {
    const el = map.querySelector(`[data-k="${CSS.escape(k)}"]`);
    if (!el || !el.getClientRects().length) return null;
    const closed = el.parentElement && el.parentElement.closest("details:not([open])");   // inside a folded group
    return closed ? null : el;
  };
  const anchor = (el, side) => {
    const head = el.matches("details,section") ? el.querySelector(".mg-head") || el : el;
    const r = (el.matches("details:not([open])") ? head : el).getBoundingClientRect();
    return [side === "r" ? r.right - r0.left : r.left - r0.left, r.top - r0.top + Math.min(r.height / 2, 22)];
  };
  const seen = new Set(), paths = [];
  for (const l of S.mapLinks || []) {
    const ea = vis(l.a);
    let eb = vis(l.b), bk = l.b;
    if (!eb && l.g) { eb = vis(l.g); bk = l.g; }
    if (!ea || !eb) continue;
    const id = l.a + ">" + bk + ">" + l.rel;
    if (seen.has(id)) continue;
    seen.add(id);
    const [x1, y1] = anchor(ea, "r"), [x2, y2] = anchor(eb, "l"), dx = Math.max(24, (x2 - x1) / 2);
    const quiet = !(bk === "g:key" || l.g === "g:key" || l.a === "g:key") || bk !== l.b;   // 판정을 정한 조건 외 선, 접힌 묶음으로 모인 선은 평소에 숨김
    paths.push(`<path class="lk lk-${l.rel}${quiet ? " lk-quiet" : ""}" data-a="${esc(l.a)}" data-b="${esc(bk)}" d="M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}"/>`);
  }
  svg.innerHTML = paths.join("");
  if (S.mapPin) hlMap(S.mapPin, true);   // 다시 그린 뒤에도 고정 유지
}
function hlMap(k, on) {
  const map = document.getElementById("emap");
  if (!map) return;
  map.classList.toggle("hl-on", on);
  const rel = new Set([k]);
  for (const p of map.querySelectorAll("path.lk")) {
    const hit = on && (p.dataset.a === k || p.dataset.b === k);
    p.classList.toggle("hl", hit);
    if (hit) { rel.add(p.dataset.a); rel.add(p.dataset.b); }
  }
  // a criterion also lights its group → conclusion line
  if (on && k.startsWith("c:")) {
    const g = map.querySelector(`[data-k="${CSS.escape(k)}"]`)?.closest(".mgroup");
    if (g) for (const p of map.querySelectorAll(`path.lk[data-a="${CSS.escape(g.dataset.k)}"]`)) { p.classList.add("hl"); rel.add("t"); }
  }
  for (const el of map.querySelectorAll("[data-k]")) el.classList.toggle("hl", on && rel.has(el.dataset.k));
}
function wireMap() {
  const map = document.getElementById("emap");
  if (S._ro) { S._ro.disconnect(); S._ro = null; }
  for (const el of document.querySelectorAll("[data-mtrial]")) el.onclick = () => { S.mapTrial = el.dataset.mtrial; S.mapPin = null; closePanel(); render(); };
  for (const el of document.querySelectorAll("[data-pview]")) el.onclick = () => { S.pview = el.dataset.pview; closePanel(); render(); };
  if (!map) return;
  for (const el of map.querySelectorAll(".mnode,.mdoc,.mgroup,.mend")) {
    const k = el.dataset.k;
    const target = el.matches(".mgroup") ? el.querySelector(".mg-head") : el;
    const back = () => (S.mapPin ? hlMap(S.mapPin, true) : hlMap(k, false));   // 고정한 항목이 있으면 그 선으로 돌아감
    target.addEventListener("mouseenter", () => hlMap(k, true));
    target.addEventListener("mouseleave", back);
    target.addEventListener("focusin", () => hlMap(k, true));
    target.addEventListener("focusout", back);
    target.addEventListener("click", () => { S.mapPin = S.mapPin === k ? null : k; hlMap(k, !!S.mapPin); });   // 클릭: 선 고정 / 다시 클릭: 해제
  }
  map.addEventListener("click", (e) => { if (!e.target.closest(".mnode,.mdoc,.mg-head,.mend")) { S.mapPin = null; hlMap("", false); } });   // 빈 곳 클릭: 해제
  if (S.mapPin && !map.querySelector(`[data-k="${CSS.escape(S.mapPin)}"]`)) S.mapPin = null;
  for (const dd of map.querySelectorAll("details.mgroup")) dd.addEventListener("toggle", () => requestAnimationFrame(drawMap));
  S._ro = new ResizeObserver(() => requestAnimationFrame(drawMap));
  S._ro.observe(map);
  requestAnimationFrame(drawMap);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => requestAnimationFrame(drawMap));
}

/* ---------- evidence panel ---------- */
function closePanel() { $("#panel").classList.add("hidden"); $(".layout").classList.remove("with-panel"); S.selSent = null; document.querySelectorAll(".sent.sel, tr.sel").forEach((x) => x.classList.remove("sel")); }
function openPanel(title, html) {
  $("#panel-title").textContent = title; $("#panel-body").innerHTML = html;
  $("#panel").classList.remove("hidden"); $(".layout").classList.add("with-panel");
  $("#panel-body").scrollTop = 0;
  const mk = $("#panel-body mark"); if (mk) mk.scrollIntoView({ block: "center" });
  wirePanel();
}
const kv = (o) => `<dl class="kv">${Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => `<dt>${esc(KEYS[k] || k)}</dt><dd>${esc(typeof v === "object" ? JSON.stringify(v) : v)}</dd>`).join("")}</dl>`;

function docHTML(b, docId, span) {
  const doc = b.patient.documents.find((x) => x.doc_id === docId);
  if (!doc) return `<p class="empty">문서 ${esc(docId)}를 찾지 못했습니다.</p>`;
  const spans = span ? [span] : b.graph.nodes.filter((n) => n.kind === "source" && n.doc_id === docId).map((n) => n.span);
  spans.sort((x, y) => x[0] - y[0]);
  const ds = demoSplit(doc.text);   // 시연용 답 문서는 앞 표시 문장을 떼고 태그로 보인다 (span 위치는 원문 기준 그대로)
  let t = "", pos = ds.cut;
  for (const [a, z] of spans) {
    if (a < pos) continue;
    t += esc(doc.text.slice(pos, a)) + "<mark>" + esc(doc.text.slice(a, z)) + "</mark>";
    pos = z;
  }
  t += esc(doc.text.slice(pos));
  return `<figure class="docfig"><figcaption><span class="mono">${esc(doc.doc_id)}</span><span>${esc(doc.type)}</span><span class="mono">${esc(doc.date)}</span><span>${esc(doc.author_role || "")}</span>${ds.demo ? DEMO_TAG : ""}</figcaption><div class="doc" lang="en" tabindex="0" aria-label="${esc(doc.doc_id)} 원문">${t}</div></figure>`;
}

function refHTML(b, r, withDoc) {
  const m = model(b), n = m.nodes.get(r), [p] = r.split(":");
  let h = `<p class="ref-id mono">${esc(r)}</p>`;
  if (p === "rule") return h + `<p>${esc(b.rules[r] || "")}</p><p class="meta">고정 안내 문구 (환자 기록 근거 아님)</p>`;
  if (p === "gloss") { const g = b.glossary[r]; return h + (g ? kv({ 원어: g.en, 한국어: g.ko, 약어: g.abbr }) + `<p class="meta">용어 사전</p>` : ""); }
  if (!n) return h + `<p class="meta">그래프에 없는 ID입니다.</p>`;
  if (n.kind === "decision") {
    const cr = m.nodes.get("crit:" + n.criterion_id), si = statusInfo(n, cr && cr.type);
    h += `<div class="dec-head">${pill(si)}</div>${cr ? `<p class="crit-text" lang="en">${esc(cr.text)}</p>` : ""}` +
      kv({ status: n.status, reason: n.reason, action: n.action, note: n.note, missing_fact: n.missing_fact, judged_by: n.judged_by, round: "r" + n.round + " (" + n.by + ")" });
    const ev = (m.inn.get(r) || []).map(([rel, s]) => [rel, m.nodes.get(s)]).filter(([, x]) => x);
    if (ev.length) h += `<h3 class="sub">근거 ${ev.length}개</h3>` + ev.map(([rel, x]) => `<div class="ref-block rel-${esc(rel)}"><span class="tag">${REL[rel] || esc(rel)}</span>${refHTML(b, x.id, true)}</div>`).join("");
    return h;
  }
  if (n.kind === "evidence") {
    h += kv({ concept: n.concept, term: n.term, value: n.value, unit: n.unit, observed_date: n.observed_date, certainty: n.certainty, subject: n.subject });
    for (const [rel, s] of m.out.get(r) || []) if (rel === "derived_from") { const src = m.nodes.get(s); if (src) h += withDoc !== false ? docHTML(b, src.doc_id, src.span) : ""; }
    return h;
  }
  if (n.kind === "source") return h + docHTML(b, n.doc_id, n.span);
  if (n.kind === "calculation") {
    h += kv(Object.fromEntries(Object.entries(n).filter(([k]) => !["id", "kind"].includes(k))));
    for (const [rel, d] of m.out.get(r) || []) if (rel === "computes") {
      for (const [, s] of m.inn.get(d) || []) {
        const x = m.nodes.get(s);
        if (x && x.kind === "evidence") h += `<div class="ref-block"><span class="tag">계산에 쓴 값</span>${refHTML(b, x.id, true)}</div>`;
      }
    }
    return h;
  }
  if (n.kind === "criterion") return h + `<p class="crit-text" lang="en">${esc(n.text)}</p>` + kv({ type: n.type, administrative: n.administrative, cohort: n.cohort });
  if (n.kind === "trial_decision") return h + `<p>${labelBadge(n.label)}</p>` + kv({ why: (n.why || []).join(", "), by: n.by });
  if (n.kind === "trial") {
    const t = b.trials[n.id.slice(6)] || {};
    return h + `<p><b>${esc(n.title)}</b></p>` + kv({ 단계: (t.phases || []).join(", "), 모집: t.overall_status, 확인: t.status_verified, 배정: t.allocation, 질환: (t.conditions || []).join(", ") });
  }
  return h + kv(n);
}

const PRI = ["src", "ev", "calc", "dec", "crit", "gloss", "label", "trial", "rule"];
function showRefs(refs, title) {
  const b = cur();
  const sorted = [...refs].sort((x, y) => PRI.indexOf(x.split(":")[0]) - PRI.indexOf(y.split(":")[0]));
  let body = sorted.map((r) => `<div class="ref-block">${refHTML(b, r)}</div>`).join("");
  if (!body.includes("<mark>")) body = `<p class="note">${noSourceWhy(b, sorted)}</p>` + body;
  openPanel(title || "근거", body);
}
function noSourceWhy(b, refs) {
  const m = model(b), kinds = new Set(refs.map((r) => r.split(":")[0]));
  if (!refs.length) return "환자 ID와 기준일 표시 줄이라 근거가 없습니다.";
  const missing = refs.some((r) => { const n = m.nodes.get(r); return n && n.kind === "decision" && n.status === "UNKNOWN"; });
  if (missing) return "기록에서 근거를 찾지 못한 항목이라 원문 표시가 없습니다. 아래 판정의 필요한 정보를 확인하세요.";
  if ([...kinds].every((k) => ["rule", "trial", "label", "gloss", "crit"].includes(k)))
    return "환자 기록이 아니라 시험 정보, 용어 사전, 고정 안내 문구에서 나온 문장이라 원문 표시가 없습니다.";
  return "이 근거에는 연결된 환자 기록 원문이 없습니다.";
}

/* ---------- events ---------- */
function wireRefs(root) {
  for (const el of root.querySelectorAll("[data-refs]")) {
    const go = (e) => { e.stopPropagation(); if (el.tagName === "TR") { document.querySelectorAll("tr.sel").forEach((x) => x.classList.remove("sel")); el.classList.add("sel"); } showRefs(el.dataset.refs.split(","), "근거"); };
    el.onclick = go;
    if (el.tagName === "TR") el.onkeydown = (e) => { if (e.key === "Enter") go(e); };
  }
  for (const el of root.querySelectorAll("[data-doc]")) el.onclick = () => { const isNew = el.classList.contains("linkish"); openPanel(isNew ? "새 문서" : "기록 원문", docHTML(cur(), el.dataset.doc)); };
}
function wirePanel() { wireRefs($("#panel-body")); }
function wire() {
  const b = cur();
  for (const el of document.querySelectorAll("[data-sent]")) {
    const go = () => {
      const [aud, i] = el.dataset.sent.split(":");
      const s = b.briefing[aud].sentences[+i];
      document.querySelectorAll(".sent.sel").forEach((x) => x.classList.remove("sel"));
      el.classList.add("sel"); S.selSent = aud + i;
      showRefs(s.refs, `문장 근거 ${s.refs.length}개`);
    };
    el.onclick = go;
    el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
  }
  for (const el of document.querySelectorAll(".card-link")) el.onclick = (e) => {
    e.stopPropagation();
    const id = el.dataset.cards.split(",")[0], c = document.getElementById("card-" + id);
    if (c) { c.closest("details")?.setAttribute("open", ""); c.scrollIntoView({ block: "center" }); c.classList.remove("flash"); void c.offsetWidth; c.classList.add("flash"); }
  };
  wireRefs(document.querySelector("#main"));
  wireRefs(document.querySelector("#update-summary"));
  for (const el of document.querySelectorAll("[data-trial]")) el.onclick = () => { S.view = "clinician"; S.trialSel = el.dataset.trial; S.filter = "all"; history.replaceState(null, "", "#clinician"); closePanel(); render(); window.scrollTo(0, 0); };
  for (const el of document.querySelectorAll("[data-tsel]")) el.onclick = () => { S.trialSel = el.dataset.tsel; S.filter = "all"; closePanel(); render(); };
  for (const el of document.querySelectorAll("[data-filter]")) el.onclick = (e) => { e.stopPropagation(); S.filter = el.dataset.filter; render(); };
  for (const el of document.querySelectorAll("[data-lang]")) el.onclick = () => { S.lang = el.dataset.lang; render(); };
  for (const el of document.querySelectorAll("form[data-replay]")) el.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(el), date = String(f.get("date") || ""), text = String(f.get("text") || "").trim();
    const di = el.querySelector("input[name=date]"), err = el.querySelector(".af-err"), max = di.getAttribute("max");
    const bad = !date ? "날짜를 넣어 주세요." : max && date > max ? `기준일(${max}) 이후 날짜는 넣을 수 없습니다.` : !text ? "내용을 넣어 주세요." : "";
    err.hidden = !bad; err.textContent = bad;
    di.setAttribute("aria-invalid", String(!!bad && bad !== "내용을 넣어 주세요."));
    if (bad) { (bad === "내용을 넣어 주세요." ? el.querySelector("textarea") : di).focus(); return; }
    S.typed[el.dataset.replay] = { date, text };
    for (const x of el.elements) x.disabled = true;
    el.classList.add("sent");
    el.querySelector("button[type=submit]").textContent = "입력됨. 2차 판정 결과를 불러오는 중입니다";
    setTimeout(() => { S.state = "after"; render(); window.scrollTo(0, 0); }, 900);
  };
  const keep = (sel) => { S.refocus = sel; render(); };
  for (const el of document.querySelectorAll("[data-ans]")) el.onclick = () => {
    const R = myResp();
    for (const k of el.dataset.rk.split(",")) R[k] = { answer: el.dataset.ans, review: null };
    keep(el.dataset.ans === "unsure" ? `[data-unans="${CSS.escape(el.dataset.rk)}"]` : `[data-ans="${el.dataset.ans}"][data-rk="${CSS.escape(el.dataset.rk)}"]`);
  };
  for (const el of document.querySelectorAll("[data-unans]")) el.onclick = () => {
    const R = myResp();
    for (const k of el.dataset.unans.split(",")) delete R[k];
    keep(`[data-ans="yes"][data-rk="${CSS.escape(el.dataset.unans)}"]`);
  };
  for (const el of document.querySelectorAll("[data-review]")) el.onclick = () => {
    const r = myResp()[el.dataset.rk];
    if (!r) return;
    r.review = r.review === el.dataset.review ? null : el.dataset.review;
    keep(`[data-review="${el.dataset.review}"][data-rk="${CSS.escape(el.dataset.rk)}"]`);
  };
  for (const el of document.querySelectorAll("[data-copy]")) el.onclick = async () => {
    const lines = [...document.querySelectorAll(".chk-list li[data-line]")].map((x) => x.dataset.line);
    const text = `의료진에게 확인을 부탁드릴 항목 (${S.pid}, 기준일 ${cur().meta.as_of})\n` + lines.join("\n");
    const msg = el.parentElement.querySelector(".copy-msg");
    try { await navigator.clipboard.writeText(text); msg.textContent = `${lines.length}개 항목을 복사했습니다.`; }
    catch (e) {
      const ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", ""); ta.className = "visually-hidden"; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
      ta.remove(); msg.textContent = ok ? `${lines.length}개 항목을 복사했습니다.` : "복사하지 못했습니다. 목록을 직접 선택해 복사해 주세요.";
    }
  };
  if (S.refocus) { const f = document.querySelector(S.refocus); S.refocus = null; if (f) f.focus({ preventScroll: false }); }
}

init();
