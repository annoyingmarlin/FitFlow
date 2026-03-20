// ══════════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════════
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW    = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// ══════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════
let currentDate     = new Date();
let viewDate        = new Date();
let selectedDateKey = null;
let prevTab         = 'progress';
let modalMeal       = null;

// ══════════════════════════════════════════
//  STORAGE HELPERS
// ══════════════════════════════════════════
function getData() {
  try { return JSON.parse(localStorage.getItem('fitflow_v3') || '{}'); }
  catch(e) { return {}; }
}

function saveData(d) {
  localStorage.setItem('fitflow_v3', JSON.stringify(d));
}

function getProfile() {
  try { return JSON.parse(localStorage.getItem('fitflow_profile_v2') || 'null'); }
  catch(e) { return null; }
}

function storeProfile(p) {
  localStorage.setItem('fitflow_profile_v2', JSON.stringify(p));
}

function getFoodDB() {
  try { return JSON.parse(localStorage.getItem('fitflow_foods') || '[]'); }
  catch(e) { return []; }
}

function saveFoodDB(db) {
  localStorage.setItem('fitflow_foods', JSON.stringify(db));
}

// ── Date key ──
function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ── Day data with defaults ──
function getDayData(key) {
  const d = getData();
  if (!d[key]) d[key] = { exercises: [], meals: { breakfast:[], lunch:[], dinner:[], snacks:[] }, calGoal: null };
  if (!d[key].meals) d[key].meals = { breakfast:[], lunch:[], dinner:[], snacks:[] };
  ['breakfast','lunch','dinner','snacks'].forEach(m => { if (!d[key].meals[m]) d[key].meals[m] = []; });
  return d[key];
}

function saveDayData(key, obj) {
  const d = getData();
  d[key] = obj;
  saveData(d);
}

// ── Save food to autocomplete DB ──
function saveFoodToDB(item) {
  const db = getFoodDB();
  const idx = db.findIndex(f => f.name.toLowerCase() === item.name.toLowerCase());
  if (idx >= 0) db[idx] = item;
  else db.unshift(item);
  saveFoodDB(db);
}

// ══════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════
function showToast(msg, dur = 3200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), dur);
}

// ══════════════════════════════════════════
//  GOAL CHECK
//  A day is "met" when calories are within ±10%
//  of the target AND protein hits ≥ 90% of goal.
// ══════════════════════════════════════════
function isDayGoalMet(key) {
  const day     = getDayData(key);
  const profile = getProfile();
  const allFood = Object.values(day.meals || {}).flat();
  const eaten   = allFood.reduce((s, f) => s + (f.cals    || 0), 0);
  const protein = allFood.reduce((s, f) => s + (f.protein || 0), 0);
  const calTarget  = day.calGoal || (profile && profile.targets ? profile.targets.calories : 0);
  const protTarget = profile && profile.targets ? profile.targets.protein : 0;
  if (!calTarget || !protTarget || eaten === 0) return false;
  return eaten >= calTarget * 0.9 && eaten <= calTarget * 1.1 && protein >= protTarget * 0.9;
}

// ══════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════
function showTab(tab, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.bottom-nav-item').forEach(n => n.classList.remove('active'));

  const pid = 'page' + tab.charAt(0).toUpperCase() + tab.slice(1);
  document.getElementById(pid).classList.add('active');
  if (el) el.classList.add('active');

  updateHeaderForTab(tab);

  if      (tab === 'progress') renderProgress();
  else if (tab === 'calendar') renderCalendar();
  else if (tab === 'daily')    renderDaily();
  else if (tab === 'profile')  renderProfilePage();
}

function updateHeaderForTab(tab) {
  const h   = document.getElementById('mainHeader');
  const old = h.querySelector('.btn-back');
  if (old) old.remove();

  const pb = document.getElementById('profileBtn');

  if (tab === 'daily' || tab === 'profile') {
    const btn  = document.createElement('button');
    btn.className = 'btn-back';
    btn.innerHTML = '← Back';
    const back = prevTab || 'progress';
    btn.onclick = () => {
      const el = document.getElementById('nav-' + back);
      showTab(back, el);
    };
    h.insertBefore(btn, h.querySelector('.header-right'));
    pb.style.display = tab === 'profile' ? 'none' : '';
  } else {
    pb.style.display = '';
  }
}

function currentActiveTab() {
  for (const t of ['progress', 'calendar', 'daily', 'profile']) {
    if (document.getElementById('page' + t.charAt(0).toUpperCase() + t.slice(1)).classList.contains('active')) return t;
  }
  return 'progress';
}

function openProfile() {
  prevTab = currentActiveTab();
  showTab('profile', null);
}

function gotoToday() {
  prevTab = currentActiveTab();
  selectedDateKey = dateKey(currentDate);
  showTab('daily', document.getElementById('nav-today'));
}

function openDay(key) {
  prevTab = currentActiveTab();
  selectedDateKey = key;
  showTab('daily', null);
}

// ══════════════════════════════════════════
//  PROFILE & MACRO CALCULATION
// ══════════════════════════════════════════

// Mifflin-St Jeor BMR → TDEE → deficit targets
function calcTargets(p) {
  const w_kg = p.weight * 0.453592;
  const h_cm = p.height * 2.54;
  let bmr = p.sex === 'male'
    ? 10 * w_kg + 6.25 * h_cm - 5 * p.age + 5
    : 10 * w_kg + 6.25 * h_cm - 5 * p.age - 161;
  const tdee    = bmr * parseFloat(p.activity);
  const defCals = tdee - 500;                              // ~1 lb/week
  const protein = Math.round(p.weight * 0.85);             // muscle preservation
  const fat     = Math.round(defCals * 0.25 / 9);
  const carbs   = Math.max(Math.round((defCals - protein * 4 - fat * 9) / 4), 50);
  return {
    calories: Math.round(defCals),
    protein,
    carbs,
    fat,
    tdee: Math.round(tdee),
    bmr:  Math.round(bmr)
  };
}

function saveProfile() {
  const name     = document.getElementById('pName').value.trim();
  const sex      = document.getElementById('pSex').value;
  const age      = parseInt(document.getElementById('pAge').value);
  const weight   = parseFloat(document.getElementById('pWeight').value);
  const ft       = parseInt(document.getElementById('pHeightFt').value) || 0;
  const inch     = parseInt(document.getElementById('pHeightIn').value) || 0;
  const height   = ft * 12 + inch;   // total inches
  const activity = document.getElementById('pActivity').value;

  if (!name)             { showToast('Please enter your name');    return; }
  if (!sex)              { showToast('Please select sex');         return; }
  if (!age || !weight || !ft) { showToast('Please fill in all fields'); return; }

  const targets = calcTargets({ sex, age, weight, height, activity });
  const profile = { name, sex, age, weight, height, heightFt: ft, heightIn: inch, activity, targets };
  storeProfile(profile);
  renderProfilePage();
  updateProfileBtn();
  showToast(`✅ Saved! Hi ${name}! Your targets are set.`, 4000);
}

function renderProfilePage() {
  const p = getProfile();
  if (!p) return;

  document.getElementById('pName').value      = p.name     || '';
  document.getElementById('pSex').value       = p.sex      || '';
  document.getElementById('pAge').value       = p.age      || '';
  document.getElementById('pWeight').value    = p.weight   || '';
  document.getElementById('pHeightFt').value  = p.heightFt || Math.floor((p.height || 0) / 12) || '';
  document.getElementById('pHeightIn').value  = p.heightIn !== undefined ? p.heightIn : ((p.height || 0) % 12) || '';
  document.getElementById('pActivity').value  = p.activity || '1.55';

  document.getElementById('profileDisplayName').textContent = p.name;

  const ft   = p.heightFt || Math.floor((p.height || 0) / 12);
  const inch = p.heightIn !== undefined ? p.heightIn : (p.height || 0) % 12;
  document.getElementById('profileDisplaySub').textContent =
    `${p.sex === 'male' ? '♂ Male' : '♀ Female'} · ${p.age} yrs · ${p.weight} lbs · ${ft}'${inch}"`;
  document.getElementById('profileAvatar').textContent = p.sex === 'female' ? '👩' : '👨';

  if (p.targets) {
    const t = p.targets;
    document.getElementById('profileTargetsCard').style.display = 'block';
    document.getElementById('profileTargets').innerHTML = `
      <div class="macro-targets">
        <div class="macro-target"><div class="label">Calories / day</div><div class="value c">${t.calories} kcal</div></div>
        <div class="macro-target"><div class="label">Protein / day</div><div class="value p">${t.protein}g</div></div>
        <div class="macro-target"><div class="label">Carbs / day</div><div class="value ca">${t.carbs}g</div></div>
        <div class="macro-target"><div class="label">Fat / day</div><div class="value f">${t.fat}g</div></div>
      </div>`;
    document.getElementById('profileFormula').innerHTML =
      `BMR: <b>${t.bmr} kcal</b> &nbsp;·&nbsp; TDEE: <b>${t.tdee} kcal</b><br>
       Goal: TDEE − 500 kcal/day ≈ 1 lb/week fat loss<br>
       Protein: ${p.weight} lbs × 0.85 = ${t.protein}g (muscle preservation)<br>
       Calories ✓ = within 10% of target &amp; protein ≥ 90% of goal`;
  }
}

function updateProfileBtn() {
  const p   = getProfile();
  const btn = document.getElementById('profileBtn');
  if (p) {
    btn.classList.add('has-profile');
    btn.textContent = p.sex === 'female' ? '👩' : '👨';
  }
}

// ══════════════════════════════════════════
//  CALENDAR
// ══════════════════════════════════════════
function changeMonth(dir) {
  viewDate.setMonth(viewDate.getMonth() + dir);
  renderCalendar();
}

function renderCalendar() {
  const y   = viewDate.getFullYear();
  const m   = viewDate.getMonth();
  document.getElementById('calMonthLabel').textContent = `${MONTHS[m]} ${y}`;

  const first    = new Date(y, m, 1).getDay();
  const dim      = new Date(y, m + 1, 0).getDate();
  const todayKey = dateKey(currentDate);
  const data     = getData();

  let html = '';
  for (let i = 0; i < first; i++) html += `<div class="cal-day empty"></div>`;

  for (let d = 1; d <= dim; d++) {
    const date    = new Date(y, m, d);
    const key     = dateKey(date);
    const isToday = key === todayKey;
    const isPast  = date < currentDate && !isToday;
    const hasData = !!data[key] && (
      Object.values(data[key].meals || {}).flat().length > 0 ||
      (data[key].exercises || []).some(e => (e.sets || []).length > 0)
    );
    const goalMet = hasData && isDayGoalMet(key);

    html += `<div class="cal-day${isToday ? ' today' : ''}${isPast ? ' past' : ''}${goalMet ? ' goal-met' : ''}" onclick="openDay('${key}')">
      ${d}
      <span class="cal-check">✓</span>
      ${hasData && !goalMet ? '<div class="cal-dot"></div>' : ''}
      ${goalMet ? '<div class="cal-dot"></div>' : ''}
    </div>`;
  }
  document.getElementById('calDays').innerHTML = html;

  // Month summary stats
  let totalCals = 0, daysLogged = 0, totalReps = 0, goalDays = 0;
  for (let d = 1; d <= dim; d++) {
    const key = dateKey(new Date(y, m, d));
    if (data[key]) {
      const meals = data[key].meals || {};
      const c = Object.values(meals).flat().reduce((s, f) => s + (f.cals || 0), 0);
      const r = (data[key].exercises || []).reduce((s, e) => s + (e.sets || []).reduce((a, v) => a + v, 0), 0);
      if (c > 0 || r > 0) { daysLogged++; totalCals += c; totalReps += r; }
      if (isDayGoalMet(key)) goalDays++;
    }
  }

  document.getElementById('monthStats').innerHTML = `
    <div style="background:var(--surface2);border-radius:var(--radius-sm);padding:12px;text-align:center">
      <div style="font-family:var(--font-mono);font-size:20px;color:var(--accent)">${daysLogged}</div>
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase">Days Logged</div>
    </div>
    <div style="background:var(--surface2);border-radius:var(--radius-sm);padding:12px;text-align:center">
      <div style="font-family:var(--font-mono);font-size:20px;color:var(--accent)">${goalDays} ✓</div>
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase">Goals Met</div>
    </div>
    <div style="background:var(--surface2);border-radius:var(--radius-sm);padding:12px;text-align:center">
      <div style="font-family:var(--font-mono);font-size:20px;color:var(--text)">${totalReps.toLocaleString()}</div>
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase">Total Reps</div>
    </div>
    <div style="background:var(--surface2);border-radius:var(--radius-sm);padding:12px;text-align:center">
      <div style="font-family:var(--font-mono);font-size:20px;color:var(--accent2)">${(totalCals / 1000).toFixed(1)}k</div>
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase">kcal Eaten</div>
    </div>`;
}

// ══════════════════════════════════════════
//  DAILY PAGE
// ══════════════════════════════════════════
function renderDaily() {
  if (!selectedDateKey) selectedDateKey = dateKey(currentDate);
  const pts = selectedDateKey.split('-');
  const d   = new Date(parseInt(pts[0]), parseInt(pts[1]) - 1, parseInt(pts[2]));
  document.getElementById('dailyDateBig').textContent = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  document.getElementById('dailyDateSub').textContent = `${DOW[d.getDay()]} · ${pts[0]}`;
  renderExercises();
  renderMeals();
}

// ── Exercises ──────────────────────────────
function renderExercises() {
  const day  = getDayData(selectedDateKey);
  const list = document.getElementById('exerciseList');

  if (!day.exercises || !day.exercises.length) {
    list.innerHTML = `<div class="empty-state"><div class="emoji">💪</div>No exercises yet. Add one below!</div>`;
    return;
  }

  list.innerHTML = day.exercises.map((ex, ei) => {
    const total = (ex.sets || []).reduce((s, r) => s + r, 0);
    const goal  = ex.goal || 0;
    const pct   = goal > 0 ? Math.min(100, (total / goal) * 100) : 0;
    const done  = goal > 0 && total >= goal;
    const sets  = (ex.sets || []).map((r, si) =>
      `<div class="rep-entry">
        <span>Set ${si + 1} — ${r} reps</span>
        <span class="rep-del" onclick="deleteRep(${ei},${si})">×</span>
      </div>`
    ).join('');

    return `<div class="exercise-block">
      <div class="exercise-header">
        <div>
          <div class="exercise-name">${ex.name} ${done ? '✅' : ''}</div>
          <div class="exercise-stats"><strong>${total}</strong> / ${goal || '∞'} reps</div>
        </div>
        <button class="btn btn-danger btn-sm" onclick="deleteExercise(${ei})">Delete</button>
      </div>
      ${goal > 0 ? `<div class="progress-bar"><div class="progress-fill${done ? ' done' : ''}" style="width:${pct}%"></div></div>` : ''}
      <div class="rep-input-row">
        <input class="input" id="ri_${ei}" type="number" placeholder="Reps" min="1">
        <button class="btn btn-accent btn-sm" onclick="addReps(${ei})">＋ Add</button>
      </div>
      <div class="rep-history">${sets}</div>
      <div style="height:1px;background:var(--border);margin-top:10px"></div>
    </div>`;
  }).join('');
}

function toggleNewExForm() {
  const f = document.getElementById('newExForm');
  f.style.display = f.style.display === 'none' ? 'block' : 'none';
}

function addExercise() {
  const name = document.getElementById('newExName').value.trim();
  const goal = parseInt(document.getElementById('newExGoal').value) || 0;
  if (!name) { showToast('Enter exercise name'); return; }
  const day = getDayData(selectedDateKey);
  day.exercises.push({ name, goal, sets: [] });
  saveDayData(selectedDateKey, day);
  document.getElementById('newExName').value = '';
  document.getElementById('newExGoal').value = '';
  toggleNewExForm();
  renderExercises();
  showToast(`✅ ${name} added!`);
}

function addReps(ei) {
  const inp  = document.getElementById(`ri_${ei}`);
  const reps = parseInt(inp.value);
  if (!reps || reps < 1) { showToast('Enter valid reps'); return; }
  const day = getDayData(selectedDateKey);
  if (!day.exercises[ei].sets) day.exercises[ei].sets = [];
  day.exercises[ei].sets.push(reps);
  const total = day.exercises[ei].sets.reduce((s, r) => s + r, 0);
  const goal  = day.exercises[ei].goal;
  saveDayData(selectedDateKey, day);
  inp.value = '';
  renderExercises();
  if (goal > 0 && total >= goal) {
    const p = getProfile();
    showToast(`🎉 ${p ? 'Congrats ' + p.name + '! ' : ''}Goal reached for ${day.exercises[ei].name}!`, 4000);
  }
}

function deleteRep(ei, si) {
  const day = getDayData(selectedDateKey);
  day.exercises[ei].sets.splice(si, 1);
  saveDayData(selectedDateKey, day);
  renderExercises();
}

function deleteExercise(ei) {
  const day  = getDayData(selectedDateKey);
  const name = day.exercises[ei].name;
  day.exercises.splice(ei, 1);
  saveDayData(selectedDateKey, day);
  renderExercises();
  showToast(`Deleted ${name}`);
}

// ── Meals & Macros ─────────────────────────
const MEAL_LABELS = {
  breakfast: '🍳 Breakfast',
  lunch:     '🥗 Lunch',
  dinner:    '🍽 Dinner',
  snacks:    '🍎 Snacks'
};

function renderMeals() {
  const day = getDayData(selectedDateKey);
  const p   = getProfile();
  const t   = p && p.targets ? p.targets : null;

  // Daily target banner
  document.getElementById('dailyGoalDisplay').innerHTML = t
    ? `<div class="label">Daily Targets (from profile)</div>
       <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:5px;font-family:var(--font-mono);font-size:12px">
         <span style="color:var(--accent2)">${t.calories} kcal</span>
         <span style="color:var(--accent3)">${t.protein}g protein</span>
         <span style="color:var(--warn)">${t.carbs}g carbs</span>
         <span style="color:#a78bfa">${t.fat}g fat</span>
       </div>`
    : `<div class="label" style="color:var(--warn)">⚠ Tap 👤 to set up your profile and get personalized targets</div>`;

  // Totals
  const allFood = Object.values(day.meals || {}).flat();
  const eaten   = allFood.reduce((s, f) => s + (f.cals    || 0), 0);
  const protein = allFood.reduce((s, f) => s + (f.protein || 0), 0);
  const carbs   = allFood.reduce((s, f) => s + (f.carbs   || 0), 0);
  const fat     = allFood.reduce((s, f) => s + (f.fat     || 0), 0);

  const pBar = (v, tgt, col) => tgt
    ? `<div style="height:3px;background:var(--border);border-radius:2px;margin-top:4px;overflow:hidden">
         <div style="height:100%;border-radius:2px;background:${col};width:${Math.min(100, (v / tgt) * 100)}%;transition:width .4s"></div>
       </div>`
    : '';

  document.getElementById('macroPills').innerHTML = `
    <div class="macro-pill" style="flex:1.5">
      <div class="mv c">${eaten}<span style="font-size:10px;color:var(--muted)">/${t ? t.calories : '?'}</span></div>
      <div class="ml">kcal</div>${pBar(eaten, t && t.calories, 'var(--accent2)')}
    </div>
    <div class="macro-pill">
      <div class="mv p">${protein}g</div>
      <div class="ml">protein</div>${pBar(protein, t && t.protein, 'var(--accent3)')}
    </div>
    <div class="macro-pill">
      <div class="mv ca">${carbs}g</div>
      <div class="ml">carbs</div>${pBar(carbs, t && t.carbs, 'var(--warn)')}
    </div>
    <div class="macro-pill">
      <div class="mv f">${fat}g</div>
      <div class="ml">fat</div>${pBar(fat, t && t.fat, '#a78bfa')}
    </div>`;

  // Meal sections with per-meal + button
  let html = '';
  for (const [meal, label] of Object.entries(MEAL_LABELS)) {
    const items = (day.meals || {})[meal] || [];
    const mc    = items.reduce((s, f) => s + (f.cals || 0), 0);
    const ihtml = items.map((f, fi) => `
      <div class="food-item">
        <div>
          <div>${f.name}</div>
          ${(f.protein || f.carbs || f.fat) ? `<div class="food-macros">P:${f.protein||0}g C:${f.carbs||0}g F:${f.fat||0}g</div>` : ''}
        </div>
        <span style="display:flex;align-items:center;gap:8px">
          <span class="food-cals">${f.cals} kcal</span>
          <span class="rep-del" onclick="deleteFood('${meal}',${fi})">×</span>
        </span>
      </div>`).join('');

    html += `<div class="meal-section">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div class="meal-label" style="margin-bottom:0">${label}</div>
        <div style="display:flex;align-items:center;gap:8px">
          ${mc > 0 ? `<div style="font-family:var(--font-mono);font-size:11px;color:var(--accent2)">${mc} kcal</div>` : ''}
          <button onclick="openFoodModal('${meal}')"
            style="width:26px;height:26px;border-radius:50%;background:var(--accent);border:none;color:#0e0f11;
                   font-size:17px;line-height:1;cursor:pointer;display:flex;align-items:center;
                   justify-content:center;font-weight:700;flex-shrink:0">+</button>
        </div>
      </div>
      ${ihtml || `<div style="font-size:12px;color:var(--muted);padding:2px 0 8px">Nothing logged yet</div>`}
    </div>`;
  }
  document.getElementById('mealSections').innerHTML = html;
}

function deleteFood(meal, fi) {
  const day = getDayData(selectedDateKey);
  day.meals[meal].splice(fi, 1);
  saveDayData(selectedDateKey, day);
  renderMeals();
}

// ── Food Modal ─────────────────────────────
function openFoodModal(meal) {
  modalMeal = meal;
  const labels = { breakfast: '🍳 Breakfast', lunch: '🥗 Lunch', dinner: '🍽 Dinner', snacks: '🍎 Snacks' };
  document.getElementById('modalMealLabel').textContent = labels[meal];
  document.getElementById('modalFoodName').value    = '';
  document.getElementById('modalFoodCals').value    = '';
  document.getElementById('modalFoodProtein').value = '';
  document.getElementById('modalFoodCarbs').value   = '';
  document.getElementById('modalFoodFat').value     = '';
  document.getElementById('foodSuggestions').classList.remove('show');
  document.getElementById('foodModalOverlay').classList.add('open');
  setTimeout(() => document.getElementById('modalFoodName').focus(), 350);
}

function closeFoodModal() {
  document.getElementById('foodModalOverlay').classList.remove('open');
  document.getElementById('foodSuggestions').classList.remove('show');
  modalMeal = null;
}

function closeFoodModalOnBg(e) {
  if (e.target === document.getElementById('foodModalOverlay')) closeFoodModal();
}

function onFoodSearch() {
  const query = document.getElementById('modalFoodName').value.trim().toLowerCase();
  const sugg  = document.getElementById('foodSuggestions');
  if (!query) { sugg.classList.remove('show'); return; }
  const db      = getFoodDB();
  const matches = db.filter(f => f.name.toLowerCase().includes(query)).slice(0, 8);
  if (!matches.length) { sugg.classList.remove('show'); return; }
  sugg.innerHTML = matches.map((f, i) => `
    <div class="food-sugg-item" onclick="selectSuggestion(${i})">
      <div class="food-sugg-name">${f.name}</div>
      <div class="food-sugg-meta">${f.cals} kcal · P:${f.protein||0}g C:${f.carbs||0}g F:${f.fat||0}g</div>
    </div>`).join('');
  sugg._matches = matches;
  sugg.classList.add('show');
}

function onFoodSearchKey(e) {
  if (e.key === 'Escape') { closeFoodModal(); return; }
  if (e.key === 'Enter')  { submitFoodModal(); return; }
}

function selectSuggestion(idx) {
  const sugg = document.getElementById('foodSuggestions');
  const item = sugg._matches && sugg._matches[idx];
  if (!item) return;
  document.getElementById('modalFoodName').value    = item.name;
  document.getElementById('modalFoodCals').value    = item.cals;
  document.getElementById('modalFoodProtein').value = item.protein || '';
  document.getElementById('modalFoodCarbs').value   = item.carbs   || '';
  document.getElementById('modalFoodFat').value     = item.fat     || '';
  sugg.classList.remove('show');
}

function submitFoodModal() {
  const name    = document.getElementById('modalFoodName').value.trim();
  const cals    = parseInt(document.getElementById('modalFoodCals').value)    || 0;
  const protein = parseInt(document.getElementById('modalFoodProtein').value) || 0;
  const carbs   = parseInt(document.getElementById('modalFoodCarbs').value)   || 0;
  const fat     = parseInt(document.getElementById('modalFoodFat').value)     || 0;
  if (!name || !cals) { showToast('Enter food name and calories'); return; }
  if (!modalMeal)     { closeFoodModal(); return; }

  saveFoodToDB({ name, cals, protein, carbs, fat });

  const day = getDayData(selectedDateKey);
  day.meals[modalMeal].push({ name, cals, protein, carbs, fat });
  saveDayData(selectedDateKey, day);
  closeFoodModal();
  renderMeals();

  // Check if daily targets hit
  const allFood     = Object.values(day.meals).flat();
  const totalEaten  = allFood.reduce((s, f) => s + (f.cals    || 0), 0);
  const totalProtein = allFood.reduce((s, f) => s + (f.protein || 0), 0);
  const p = getProfile();
  if (p && p.targets) {
    const calOk  = totalEaten   >= p.targets.calories * 0.9 && totalEaten   <= p.targets.calories * 1.1;
    const protOk = totalProtein >= p.targets.protein  * 0.9;
    if (calOk && protOk) showToast(`🎯 ${p.name}, you hit your daily targets! Great work!`, 4500);
  }
}

// ══════════════════════════════════════════
//  STREAKS & ACHIEVEMENTS
// ══════════════════════════════════════════
function checkStreaks() {
  let streak7 = true, streak30 = true;
  for (let i = 0; i < 7; i++) {
    const d = new Date(currentDate); d.setDate(d.getDate() - i);
    if (!isDayGoalMet(dateKey(d))) { streak7 = false; break; }
  }
  for (let i = 0; i < 30; i++) {
    const d = new Date(currentDate); d.setDate(d.getDate() - i);
    if (!isDayGoalMet(dateKey(d))) { streak30 = false; break; }
  }
  return { streak7, streak30 };
}

function getPoundsLost() {
  const data = getData();
  const p    = getProfile();
  let def    = 0;
  Object.keys(data).forEach(key => {
    const day     = data[key];
    const allFood = Object.values(day.meals || {}).flat();
    const eaten   = allFood.reduce((s, f) => s + (f.cals || 0), 0);
    const calTarget = day.calGoal || (p && p.targets ? p.targets.calories : 0);
    if (calTarget) def += (calTarget - eaten);
  });
  return Math.max(0, def / 3500);
}

// ══════════════════════════════════════════
//  PROGRESS PAGE
// ══════════════════════════════════════════
function renderProgress() {
  const data = getData();
  const keys = Object.keys(data);
  const p    = getProfile();
  const name = p ? p.name : null;

  let totalEaten = 0, totalGoal = 0, totalDeficit = 0;
  const exTotals = {};

  keys.forEach(key => {
    const day     = data[key];
    const allFood = Object.values(day.meals || {}).flat();
    const eaten   = allFood.reduce((s, f) => s + (f.cals || 0), 0);
    totalEaten   += eaten;
    const calTarget = day.calGoal || (p && p.targets ? p.targets.calories : 0);
    if (calTarget) { totalGoal += calTarget; totalDeficit += (calTarget - eaten); }
    (day.exercises || []).forEach(ex => {
      const reps = (ex.sets || []).reduce((s, r) => s + r, 0);
      exTotals[ex.name] = (exTotals[ex.name] || 0) + reps;
    });
  });

  const poundsLost = Math.max(0, totalDeficit / 3500);
  const fullPounds = Math.floor(poundsLost);
  const pctToNext  = ((poundsLost - fullPounds) * 100).toFixed(0);
  const calsToNext = totalDeficit > 0 ? Math.round(3500 - (totalDeficit % 3500)) : 3500;

  // Achievement banners
  const { streak7, streak30 } = checkStreaks();
  const plost      = getPoundsLost();
  const milestones = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
  const hit        = milestones.filter(m => plost >= m);
  const latest     = hit.length > 0 ? hit[hit.length - 1] : 0;

  let banners = '';
  if (streak30 && name) {
    banners += `<div class="achievement month">🏆 Congratulations ${name} on staying on track this month! That's incredible dedication!</div>`;
  } else if (streak7 && name) {
    banners += `<div class="achievement streak">🔥 Congratulations ${name} on staying on track this week! Keep pushing!</div>`;
  }
  if (latest > 0) {
    banners += `<div class="achievement loss">🎉 Congratulations${name ? ' ' + name : ''} on losing ${latest} lbs! Great work — keep going!</div>`;
  }
  document.getElementById('achievementBanners').innerHTML = banners;

  // Fat loss card
  const dots = [];
  for (let i = 0; i < Math.max(fullPounds + 3, 5); i++) {
    dots.push(`<div class="pound-dot${i < fullPounds ? ' filled' : ''}">${i < fullPounds ? '🔥' : i + 1}</div>`);
  }

  document.getElementById('fatCard').innerHTML = `
    <h3>🔥 Fat Loss Tracker</h3>
    <div style="display:flex;align-items:flex-end;gap:16px;margin-bottom:14px">
      <div>
        <div style="font-size:11px;color:var(--accent);font-family:var(--font-mono);margin-bottom:2px">POUNDS BURNED</div>
        <div style="font-family:var(--font-head);font-size:44px;font-weight:800;color:var(--accent);letter-spacing:-2px">${poundsLost.toFixed(2)}</div>
      </div>
      <div style="margin-bottom:10px">
        <div style="font-size:11px;color:var(--muted2)">Total Deficit</div>
        <div style="font-family:var(--font-mono);color:var(--warn)">${Math.max(0, totalDeficit).toLocaleString()} kcal</div>
      </div>
    </div>
    ${totalDeficit > 0
      ? `<div style="font-size:12px;color:var(--muted2);margin-bottom:6px">Progress to next pound</div>
         <div class="progress-bar" style="height:8px"><div class="progress-fill" style="width:${pctToNext}%"></div></div>
         <div style="font-size:11px;color:var(--muted);margin-top:4px;font-family:var(--font-mono)">${calsToNext.toLocaleString()} kcal to next pound</div>`
      : `<div style="font-size:13px;color:var(--muted)">Set up your profile and start logging to track fat loss!</div>`}
    <div class="pound-track">${dots.join('')}</div>
    ${fullPounds > 0
      ? `<div style="margin-top:14px;padding:10px;background:rgba(200,245,90,.1);border-radius:8px;text-align:center;
              font-family:var(--font-head);font-size:13px;color:var(--accent)">
           🔥 You've burned ${fullPounds} pound${fullPounds > 1 ? 's' : ''} worth of calories!
         </div>`
      : ''}`;

  // Exercise totals
  const exKeys = Object.keys(exTotals);
  document.getElementById('exerciseTotals').innerHTML = exKeys.length === 0
    ? `<div style="color:var(--muted);font-size:13px;text-align:center;padding:10px 0">No exercises logged yet</div>`
    : exKeys.map(n =>
        `<div class="progress-stat">
          <span class="progress-stat-label">${n}</span>
          <span class="progress-stat-val">${exTotals[n].toLocaleString()} reps</span>
        </div>`
      ).join('');

  // Calorie totals
  const goalDays = keys.filter(k => isDayGoalMet(k)).length;
  document.getElementById('calorieTotals').innerHTML = `
    <div class="progress-stat">
      <span class="progress-stat-label">Total Eaten</span>
      <span class="progress-stat-val" style="color:var(--accent2)">${totalEaten.toLocaleString()} kcal</span>
    </div>
    <div class="progress-stat">
      <span class="progress-stat-label">Total Goal</span>
      <span class="progress-stat-val">${totalGoal.toLocaleString()} kcal</span>
    </div>
    <div class="progress-stat">
      <span class="progress-stat-label">Net Deficit</span>
      <span class="progress-stat-val" style="color:${totalDeficit >= 0 ? 'var(--accent)' : 'var(--accent2)'}">
        ${totalDeficit >= 0 ? '+' : '-'}${Math.abs(totalDeficit).toLocaleString()} kcal
      </span>
    </div>
    <div class="progress-stat">
      <span class="progress-stat-label">Days Tracked</span>
      <span class="progress-stat-val">${keys.length}</span>
    </div>
    <div class="progress-stat">
      <span class="progress-stat-label">Goals Met ✓</span>
      <span class="progress-stat-val" style="color:var(--accent)">${goalDays}</span>
    </div>`;
}

// ══════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════
function init() {
  const today = currentDate;
  document.getElementById('headerDate').textContent =
    `${MONTHS[today.getMonth()].slice(0, 3)} ${today.getDate()}`;
  updateProfileBtn();
  renderProgress();
}

init();
