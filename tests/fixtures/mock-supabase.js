// In-memory Supabase mock persisted in localStorage (test only)
const KEY = 'mockdb';
const load = () => JSON.parse(localStorage.getItem(KEY) || '{"classes":[],"students":[],"questions":[],"tests":[],"submissions":[],"ai_usage":[]}');
const save = (db) => localStorage.setItem(KEY, JSON.stringify(db));
const uid = () => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16));
const FK = { tests: 'test_id', classes: 'class_id' };

class Query {
  constructor(table) { this.table = table; this.op = 'select'; this.filters = []; this.cols = '*'; }
  select(cols = '*', opts = {}) { if (this.op === 'select') { this.cols = cols; this.head = opts.head; } this.returnRows = true; return this; }
  insert(rows) { this.op = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  update(v) { this.op = 'update'; this.values = v; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.filters.push((r) => r[c] == v); return this; }
  in(c, arr) { this.filters.push((r) => arr.includes(r[c])); return this; }
  gte(c, v) { this.filters.push((r) => r[c] >= v); return this; }
  gt(c, v) { this.filters.push((r) => r[c] > v); return this; }
  not(c, op, v) { this.filters.push((r) => r[c] !== null && r[c] !== undefined); return this; }
  order(c, o = {}) { this.ord = [c, o.ascending !== false]; return this; }
  limit(n) { this.lim = n; return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  single() { this.isSingle = true; return this; }
  then(res, rej) { try { res(this.exec()); } catch (e) { rej(e); } }
  exec() {
    const db = load();
    if (['student_questions','material_progress'].includes(this.table) && !db[this.table]) return {data:null,error:{message:'relation does not exist'}};
    if (this.table === 'submission_drawings' && !db.submission_drawings) return { data: null, error: { message: 'relation "public.submission_drawings" does not exist' } };
    if ((this.table === 'lessons' || this.table === 'payments') && !db.lessons) return { data: null, error: { message: 'relation "public.' + this.table + '" does not exist' } };
    if (this.table === 'lesson_notes' && !db.lesson_notes) return { data: null, error: { message: 'relation "public.lesson_notes" does not exist' } };
    if (this.table === 'mistakes' && !db.mistakes) return { data: null, error: { message: 'relation "public.mistakes" does not exist' } };
    // köhnə baza təqlidi: __missing_columns = { cədvəl: ['sütun'] } — həmin sütuna yazanda xəta
    const miss = (db.__missing_columns || {})[this.table] || [];
    if ((this.op === 'update' || this.op === 'insert') && miss.some((c) => [this.values || {}, ...(this.rows || [])].some((o) => c in o))) return { data: null, error: { message: `Could not find the '${miss[0]}' column of '${this.table}' in the schema cache` } };
    let t = db[this.table] = db[this.table] || [];
    if (this.op === 'insert') {
      const made = this.rows.map((r) => ({ id: uid(), created_at: new Date().toISOString(), teacher_id: 'u1', is_open: true, options: [], ...(this.table === 'students' && !window.NO_CODES ? { access_code: Math.random().toString(36).slice(2, 10).toUpperCase() } : {}), ...r }));
      t.push(...made); save(db);
      return { data: this.isSingle ? made[0] : made, error: null };
    }
    let rows = t.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === 'update') { rows.forEach((r) => Object.assign(r, this.values)); save(db); return { data: rows, error: null }; }
    if (this.op === 'delete') {
      db[this.table] = t.filter((r) => !rows.includes(r));
      if (this.table === 'classes') db.students = db.students.filter((s) => !rows.some((r) => r.id === s.class_id));
      save(db); return { data: null, error: null };
    }
    if (this.head) return { data: null, count: rows.length, error: null };
    if (this.ord) { const [c, asc] = this.ord; rows = [...rows].sort((a, b) => (a[c] > b[c] ? 1 : -1) * (asc ? 1 : -1)); }
    if (this.lim) rows = rows.slice(0, this.lim);
    if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
    const nested = [...this.cols.matchAll(/(\w+)\(([^)]*)\)/g)];
    rows = rows.map((r) => {
      const o = { ...r };
      for (const [, name, f] of nested) {
        if (f === 'count') o[name] = [{ count: db[name].filter((x) => x.class_id === r.id).length }];
        else { const j = db[name].find((x) => x.id === r[FK[name]]); o[name] = j ? { [f]: j[f] } : null; }
      }
      return o;
    });
    if (this.isSingle) return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } };
    return { data: rows, error: null };
  }
}

export function createClient() {
  const listeners = [];
  const getS = () => JSON.parse(localStorage.getItem('mocksession') || 'null');
  const fire = (ev, s) => listeners.forEach((l) => l(ev, s));
  return {
    auth: {
      getSession: async () => ({ data: { session: getS() } }),
      onAuthStateChange: (cb) => { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithPassword: async ({ email }) => { const s = { access_token: 'tok', user: { id: 'u1', email, user_metadata: { full_name: 'Aynur' } } }; localStorage.setItem('mocksession', JSON.stringify(s)); fire('SIGNED_IN', s); return { data: { session: s }, error: null }; },
      signUp: async ({ email }) => { const s = { access_token: 'tok', user: { id: 'u1', email, user_metadata: { full_name: 'Aynur' } } }; localStorage.setItem('mocksession', JSON.stringify(s)); fire('SIGNED_IN', s); return { data: { session: s }, error: null }; },
      resetPasswordForEmail: async (email, o) => { window.__reset = { email, redirectTo: o?.redirectTo }; return { error: null }; },
      updateUser: async (u) => { window.__pw = u.password; return { data: {}, error: null }; },
      signOut: async () => { localStorage.removeItem('mocksession'); fire('SIGNED_OUT', null); return {}; }
    },
    from: (t) => new Query(t),
    storage: { from: (bucket) => ({
      upload: async (path, file, o) => { const db = load(); if (!db.lesson_notes) return { data: null, error: { message: 'Bucket not found' } }; db._files = db._files || []; db._files.push({ bucket, path, type: o?.contentType, size: file?.size }); save(db); return { data: { path }, error: null }; },
      remove: async (paths) => { const db = load(); db._files = (db._files || []).filter((f) => !paths.includes(f.path)); save(db); return { data: null, error: null }; },
      getPublicUrl: (path) => ({ data: { publicUrl: 'https://files.test/storage/v1/object/public/' + bucket + '/' + path } })
    }) },
    rpc: async (fn, a) => {
      const db = load();
      if (fn === 'ai_gate') {
        if (!db.teacher_access) return { data: null, error: { message: 'Could not find the function public.ai_gate', code: 'PGRST202' } };
        const me = db.teacher_access.find((x) => x.user_id === (getS()?.user?.id));
        return { data: me ? { approved: me.approved, is_admin: me.is_admin, registered: true, daily_limit: me.daily_limit_usd, monthly_limit: me.monthly_limit_usd, today: me.today || 0, month: me.month || 0 } : { approved: false, registered: false }, error: null };
      }
      if (fn === 'admin_teachers') {
        return { data: db.teacher_access.map((x) => ({ user_id: x.user_id, email: x.email, approved: x.approved, is_admin: x.is_admin, daily_limit: x.daily_limit_usd, monthly_limit: x.monthly_limit_usd, month: x.month || 0, questions: 0, students: 0, created_at: new Date().toISOString() })), error: null };
      }
      if (fn === 'question_stats') {
        if (!db.lessons) return { data: null, error: { message: 'Could not find the function public.question_stats' } };
        const m = {};
        db.submissions.forEach((x) => { const t = db.tests.find((y) => y.id === x.test_id); if (!t) return;
          t.question_ids.forEach((id) => { const q = db.questions.find((z) => z.id === id); if (!q || q.qtype !== 'mcq') return;
            const o = m[id] || (m[id] = { question_id: id, attempts: 0, right_count: 0 }); o.attempts++;
            if (String(x.answers[id] || '').trim().toLowerCase() === q.answer.trim().toLowerCase()) o.right_count++; }); });
        return { data: Object.values(m), error: null };
      }
      if (fn.startsWith('student_')) {
        if (window.PORTAL_DOWN) return { data: null, error: { message: 'function not found' } };
        const st = db.students.find((x) => x.access_code === String(a.p_code).toUpperCase());
        const mine = (t) => db.submissions.find((x) => x.test_id === t.id && x.student_id === st.id);
        const overdue = (t) => !!t.due_at && Date.now() > new Date(t.due_at).getTime() + 120000;
        const vis = (t) => t.class_id === st?.class_id && (!t.student_id || t.student_id === st.id);
        const rvOk = (t) => (t.review_mode || 'never') === 'after_submit' || (t.review_mode === 'after_close' && !t.is_open);
        if(fn==='student_ai_allowance') { if(!st)return {data:null,error:{message:'Link etibarsızdır'}}; if(!db.student_ai_counts)return {data:null,error:{message:'Could not find function'}};return {data:{remaining:Math.max(0,3-(db.student_ai_counts[st.id]||0)),limit:3},error:null}; }
        if (['student_hub','student_material_done','student_ask'].includes(fn)) {
          if (!db.student_questions || !db.material_progress) return {data:null,error:{message:'Could not find the function '+fn}};
          if (!st) return {data:null,error:{message:'Link etibarsızdır'}};
          const notes=(db.lesson_notes||[]).filter(n=>n.student_id===st.id||(!n.student_id&&n.class_id===st.class_id));
          if(fn==='student_hub') return {data:{schedule:db.classes.find(c=>c.id===st.class_id)?.schedule, progress:db.material_progress.filter(p=>p.student_id===st.id), messages:db.student_questions.filter(m=>m.student_id===st.id), related:notes.flatMap(n=>db.tests.filter(t=>vis(t)&&n.topic&&db.questions.some(q=>(t.question_ids||[]).includes(q.id)&&q.topic===n.topic)).map(t=>({note_id:n.id,test_id:t.id})))},error:null};
          if(fn==='student_material_done') {if(!notes.some(n=>n.id===a.p_note_id))return {data:null,error:{message:'Material tapılmadı'}};let row=db.material_progress.find(p=>p.student_id===st.id&&p.note_id===a.p_note_id);if(!row){row={student_id:st.id,note_id:a.p_note_id};db.material_progress.push(row);}row.completed=a.p_completed;save(db);return {data:null,error:null};}
          if(fn==='student_ask'){if(!(a.p_note_id?notes.some(n=>n.id===a.p_note_id):db.tests.some(t=>vis(t)&&t.id===a.p_test_id&&t.question_ids.includes(a.p_question_id))))return {data:null,error:{message:'Sual tapılmadı'}};const id=uid();db.student_questions.push({id,student_id:st.id,body:a.p_body,note_id:a.p_note_id,test_id:a.p_test_id,question_id:a.p_question_id,created_at:new Date().toISOString()});save(db);return {data:id,error:null};}
        }
        if (fn === 'student_analysis' || fn === 'student_notes') {
          if (!Array.isArray(db.lesson_notes)) return { data: null, error: { message: 'Could not find the function public.' + fn } };
          if (!st) return { data: null, error: { message: 'Link etibarsızdır' } };
          if (fn === 'student_notes') return { data: db.lesson_notes.filter((n) => n.student_id === st.id || (!n.student_id && n.class_id === st.class_id)).sort((x, y) => (x.created_at < y.created_at ? 1 : -1))
            .map((n) => ({ id: n.id, title: n.title, topic: n.topic, body: n.body, file_path: n.file_path, file_name: n.file_name, file_type: n.file_type, link_url: n.link_url || null, personal: !!n.student_id, created_at: n.created_at })), error: null };
          const cls = db.classes.find((c) => c.id === st.class_id);
          const subs = db.submissions.filter((x) => x.student_id === st.id).sort((x, y) => (x.created_at > y.created_at ? 1 : -1));
          const rv = (t) => (t.review_mode || 'never') === 'after_submit' || (t.review_mode === 'after_close' && !t.is_open);
          const tp = {}; const results = [];
          subs.forEach((x) => { const t = db.tests.find((y) => y.id === x.test_id); if (!t) return;
            const qs = t.question_ids.map((id) => db.questions.find((q) => q.id === id)).filter((q) => q && q.qtype === 'mcq');
            results.push({ title: t.title, kind: t.kind || 'homework', score: x.score, total: x.total, empty: qs.filter((q) => !String(x.answers[q.id] || '').trim()).length, at: x.created_at });
            if (rv(t)) qs.forEach((q) => { const k = (q.topic || '').trim() || 'Digər'; const o = tp[k] || (tp[k] = { topic: k, right: 0, total: 0 }); o.total++; if (String(x.answers[q.id] || '').trim().toLowerCase() === q.answer.trim().toLowerCase()) o.right++; }); });
          const ex = cls?.exam_date || null;
          return { data: { exam_date: ex, days_left: ex ? Math.round((new Date(ex + 'T00:00:00') - new Date(new Date().toDateString())) / 864e5) : null, topics: Object.values(tp), results }, error: null };
        }
        if (fn === 'student_mistakes' || fn === 'student_answer_mistake') {
          if (!Array.isArray(db.mistakes)) return { data: null, error: { message: 'Could not find the function public.' + fn } };
          if (!st) return { data: null, error: { message: 'Link etibarsızdır' } };
          const now = Date.now(); const due = (m) => m.status === 'open' && new Date(m.due_at).getTime() <= now;
          const mine2 = db.mistakes.filter((m) => m.student_id === st.id);
          if (fn === 'student_mistakes') {
            mine2.filter((m) => due(m) && !m.practice_id).forEach((m) => {
              const o = db.questions.find((q) => q.id === m.question_id);
              const c = db.questions.filter((q) => q.id !== o.id && q.qtype === 'mcq' && !m.seen.includes(q.id) && (q.similar_to === o.id || (o.topic && q.topic === o.topic)))
                .sort((x, y) => (y.similar_to === o.id) - (x.similar_to === o.id))[0];
              m.practice_id = c ? c.id : o.id;
            });
            save(db);
            const items = mine2.filter(due).slice(0, 10).map((m) => { const q = db.questions.find((x) => x.id === m.practice_id); return { id: m.id, attempts: m.attempts, due_at: m.due_at, question: { id: q.id, body: q.body, qtype: q.qtype, options: q.options, figure: q.figure || null, option_figures: q.option_figures || [], topic: q.topic } }; });
            const fut = mine2.filter((m) => m.status === 'open' && !due(m)).map((m) => m.due_at).sort();
            return { data: { name: st.full_name, items, open: mine2.filter((m) => m.status === 'open').length, due: mine2.filter(due).length, next_at: fut[0] || null, cleared: mine2.filter((m) => m.status === 'cleared').length }, error: null };
          }
          const m = mine2.find((x) => x.id === a.p_mistake && due(x));
          if (!m || !m.practice_id) return { data: null, error: { message: 'Bu sual artıq dəftərdə deyil' } };
          const q = db.questions.find((x) => x.id === m.practice_id);
          const ok = String(a.p_answer || '').trim().toLowerCase() === q.answer.trim().toLowerCase();
          m.attempts++; m.seen.push(q.id);
          if (ok) { m.status = 'cleared'; m.cleared_at = new Date().toISOString(); } else { m.practice_id = null; m.due_at = new Date(now + 2 * 864e5).toISOString(); }
          save(db);
          return { data: { correct: ok, answer: q.answer, solution: q.solution || null }, error: null };
        }
        if (fn === 'student_save_drawings') {
          if (!Array.isArray(db.submission_drawings)) return { data: null, error: { message: 'Could not find the function public.student_save_drawings' } };
          const tt = st && db.tests.find((x) => x.id === a.p_test_id); const sub = tt && mine(tt);
          if (!sub) return { data: null, error: { message: 'Əvvəlcə testi göndərin' } };
          let n = 0;
          Object.entries(a.p_drawings || {}).forEach(([k, v]) => { if (!tt.question_ids.includes(k) || !/^data:image\/(jpeg|png|webp);base64,/.test(v)) return;
            db.submission_drawings = db.submission_drawings.filter((d) => !(d.submission_id === sub.id && d.question_id === k)); db.submission_drawings.push({ submission_id: sub.id, question_id: k, image: v }); n++; });
          save(db); return { data: n, error: null };
        }
        if (fn === 'student_portal') {
          if (!st) return { data: null, error: null };
          const cls = db.classes.find((c) => c.id === st.class_id);
          const tests = db.tests.filter((t) => vis(t) && (t.is_open || mine(t))).sort((x, y) => (x.created_at < y.created_at ? 1 : -1))
            .map((t) => ({ id: t.id, title: t.title, is_open: t.is_open, created_at: t.created_at, count: t.question_ids.length, review: rvOk(t), review_mode: t.review_mode || 'never', time_limit_min: t.time_limit_min || null, due_at: t.due_at || null, overdue: overdue(t), personal: !!t.student_id, result: mine(t) ? { score: mine(t).score, total: mine(t).total, created_at: mine(t).created_at } : null }));
          return { data: { name: st.full_name, class: cls?.name, tests }, error: null };
        }
        const t = st && db.tests.find((x) => x.id === a.p_test_id && vis(x));
        db.test_starts = db.test_starts || [];
        const start = (t) => db.test_starts.find((x) => x.test_id === t.id && x.student_id === st.id);
        if (fn === 'student_start_test') {
          if (!t || !t.is_open) return { data: null, error: { message: 'Bu test bağlıdır' } };
          if (!start(t)) { db.test_starts.push({ test_id: t.id, student_id: st.id, started_at: new Date(Date.now() - (window.START_OFFSET || 0)).toISOString() }); save(db); }
          return { data: { started_at: start(t).started_at, now: new Date().toISOString() }, error: null };
        }
        if (fn === 'student_get_test') {
          if (!t) return { data: null, error: null };
          if (mine(t)) return { data: { id: t.id, title: t.title, name: st.full_name, review: rvOk(t), review_mode: t.review_mode || 'never', time_limit_min: t.time_limit_min || null, due_at: t.due_at || null, overdue: overdue(t), personal: !!t.student_id, result: { score: mine(t).score, total: mine(t).total } }, error: null };
          if (!t.is_open) return { data: { id: t.id, title: t.title, name: st.full_name, closed: true }, error: null };
          if (overdue(t)) return { data: { id: t.id, title: t.title, name: st.full_name, overdue: true, due_at: t.due_at }, error: null };
          return { data: { id: t.id, title: t.title, name: st.full_name, review_mode: t.review_mode || 'never', time_limit_min: t.time_limit_min || null, due_at: t.due_at || null, shuffle: !!t.shuffle, started_at: start(t)?.started_at || null, now: new Date().toISOString(), seed: st.id, questions: t.question_ids.map((id) => db.questions.find((q) => q.id === id)).filter(Boolean).map((q) => ({ id: q.id, body: q.body, qtype: q.qtype, options: q.options, figure: q.figure, option_figures: q.option_figures })) }, error: null };
        }
        if (fn === 'student_review') {
          if (!t || !mine(t)) return { data: null, error: null };
          if (!rvOk(t)) return { data: { id: t.id, title: t.title, name: st.full_name, allowed: false, review_mode: t.review_mode || 'never' }, error: null };
          const sub = mine(t);
          return { data: { id: t.id, title: t.title, name: st.full_name, allowed: true, score: sub.score, total: sub.total, answers: sub.answers,
            questions: t.question_ids.map((id) => db.questions.find((q) => q.id === id)).filter(Boolean) }, error: null };
        }
        if (fn === 'student_submit_test') {
          if (!t || !t.is_open) return { data: null, error: { message: 'Bu test bağlıdır' } };
          if (mine(t)) return { data: null, error: { message: 'Bu testi artıq göndərmisiniz' } };
          if (overdue(t)) return { data: null, error: { message: 'Son tarix keçib' } };
          const late = !!t.time_limit_min && (!start(t) || Date.now() > new Date(start(t).started_at).getTime() + (t.time_limit_min + 1) * 60000);
          let score = 0, total = 0;
          t.question_ids.forEach((id) => { const q = db.questions.find((x) => x.id === id); if (q && q.qtype === 'mcq') { total++; if ((a.p_answers[id] || '').trim().toLowerCase() === q.answer.trim().toLowerCase()) score++; } });
          db.submissions.push({ id: uid(), test_id: t.id, student_id: st.id, student_name: st.full_name, answers: a.p_answers, score, total, late, created_at: new Date().toISOString() });
          if (window.MISTAKES_ON !== false && Array.isArray(db.mistakes)) t.question_ids.forEach((id) => { const q = db.questions.find((x) => x.id === id); const v = String(a.p_answers[id] || '').trim();
            if (q && q.qtype === 'mcq' && v && v.toLowerCase() !== q.answer.trim().toLowerCase() && !db.mistakes.some((m) => m.student_id === st.id && m.question_id === id && m.status === 'open'))
              db.mistakes.push({ id: uid(), teacher_id: 'u1', student_id: st.id, question_id: id, test_id: t.id, status: 'open', attempts: 0, seen: [], practice_id: null, due_at: new Date(Date.now() + 864e5).toISOString(), created_at: new Date().toISOString() }); });
          save(db);
          return { data: { score, total }, error: null };
        }
      }
      const t = db.tests.find((x) => x.id === a.p_test_id);
      if (fn === 'get_test_for_student') {
        if (!t || !t.is_open) return { data: null, error: null };
        return { data: { id: t.id, title: t.title, time_limit_min: t.time_limit_min || null, due_at: t.due_at || null, shuffle: !!t.shuffle,
          students: db.students.filter((s) => s.class_id === t.class_id).map((s) => s.full_name).sort(),
          questions: t.question_ids.map((id) => db.questions.find((q) => q.id === id)).filter(Boolean).map((q) => ({ id: q.id, body: q.body, qtype: q.qtype, options: q.options, figure: q.figure, option_figures: q.option_figures })) }, error: null };
      }
      if (fn === 'submit_test') {
        let score = 0, total = 0;
        t.question_ids.forEach((id) => { const q = db.questions.find((x) => x.id === id); if (q && q.qtype === 'mcq') { total++; if ((a.p_answers[id] || '').trim().toLowerCase() === q.answer.trim().toLowerCase()) score++; } });
        db.submissions.push({ id: uid(), test_id: t.id, student_name: a.p_student_name, answers: a.p_answers, score, total, created_at: new Date().toISOString() });
        save(db);
        return { data: { score, total }, error: null };
      }
    }
  };
}
