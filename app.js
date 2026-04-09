/* ═══════════════════════════════════════════════════════════════
   MEALPLANNER — app.js  (con autenticación Supabase)
═══════════════════════════════════════════════════════════════ */

'use strict';

/* ═══════════════════════════════════════════════════
   SECCIÓN 0 — CONFIGURACIÓN SUPABASE
═══════════════════════════════════════════════════ */

const SUPABASE_URL      = 'https://nbcswsaqppckctwdeshy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5iY3N3c2FxcHBja2N0d2Rlc2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMjIwNTgsImV4cCI6MjA5MDY5ODA1OH0.-2JVxBb1wbypEpr_Y_TbCaHQkF8ayYpQL7_uI2l2Gr0';

let sb = null;
if (typeof window.supabase !== 'undefined') {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/* ═══════════════════════════════════════════════════
   SECCIÓN 0.5 — AUTENTICACIÓN
═══════════════════════════════════════════════════ */

let currentUser = null;
let isLoginMode = true; // true = login, false = register

function showAuth() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app-header').style.display = 'none';
  document.getElementById('app-main').style.display = 'none';
}

function showApp(user) {
  currentUser = user;
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-header').style.display = 'block';
  document.getElementById('app-main').style.display = 'block';
  document.getElementById('user-email').textContent = user.email;
}

function toggleAuthMode() {
  isLoginMode = !isLoginMode;
  document.getElementById('auth-title').textContent = isLoginMode ? 'Inicia sesión' : 'Crear cuenta';
  document.getElementById('auth-subtitle').textContent = isLoginMode
    ? 'Accede a tu planificador de comidas'
    : 'Regístrate para empezar a planificar';
  document.getElementById('btn-auth-submit').textContent = isLoginMode ? 'Iniciar sesión' : 'Registrarse';
  document.getElementById('auth-toggle-text').textContent = isLoginMode ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?';
  document.getElementById('btn-auth-toggle').textContent = isLoginMode ? 'Regístrate' : 'Inicia sesión';
  document.getElementById('auth-message').style.display = 'none';
  document.getElementById('auth-password').placeholder = isLoginMode ? 'Tu contraseña' : 'Mínimo 6 caracteres';
}

function showAuthMessage(msg, isError = false) {
  const el = document.getElementById('auth-message');
  el.textContent = msg;
  el.className = 'auth-message' + (isError ? ' auth-message-error' : '');
  el.style.display = 'block';
}

async function handleAuthSubmit() {
  const email    = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;

  if (!email || !password) {
    showAuthMessage('Rellena todos los campos', true);
    return;
  }

  const btn = document.getElementById('btn-auth-submit');
  btn.disabled = true;
  btn.textContent = isLoginMode ? 'Entrando...' : 'Registrando...';

  try {
    if (isLoginMode) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // onAuthStateChange se encarga del resto
    } else {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      // Si hay verificación por email, el usuario no tiene sesión aún
      if (data.user && !data.session) {
        showAuthMessage('¡Cuenta creada! Revisa tu correo para confirmar tu cuenta.');
        isLoginMode = true;
      }
    }
  } catch (err) {
    const msg = err.message || 'Error desconocido';
    const friendly = {
      'Invalid login credentials': 'Email o contraseña incorrectos',
      'User already registered': 'Este email ya está registrado',
      'Password should be at least 6 characters': 'La contraseña debe tener al menos 6 caracteres',
      'Email rate limit exceeded': 'Demasiados intentos. Espera un momento.',
    };
    showAuthMessage(friendly[msg] || msg, true);
  } finally {
    btn.disabled = false;
    btn.textContent = isLoginMode ? 'Iniciar sesión' : 'Registrarse';
  }
}

async function handleGoogleLogin() {
  try {
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
    if (error) throw error;
  } catch (err) {
    showAuthMessage(err.message || 'Error al conectar con Google', true);
  }
}

async function handleLogout() {
  await sb.auth.signOut();
  currentUser = null;
  document.getElementById('user-dropdown').style.display = 'none';
  showAuth();
}

/* ═══════════════════════════════════════════════════
   SECCIÓN 1 — CAPA DE BASE DE DATOS
   Todas las queries filtran por user_id
═══════════════════════════════════════════════════ */

const LS = {
  get: (key, def = []) => { try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; } },
  set: (key, val)       => localStorage.setItem(key, JSON.stringify(val)),
};

// ── RECETAS ──────────────────────────────────────────────────

async function getRecipes() {
  const { data, error } = await sb.from('recipes').select('*')
    .eq('user_id', currentUser.id).order('created_at');
  if (error) throw error;
  return data;
}

async function addRecipeToDB(recipe) {
  recipe.user_id = currentUser.id;
  const { data, error } = await sb.from('recipes').insert([recipe]).select().single();
  if (error) throw error;
  return data;
}

async function updateRecipeInDB(id, changes) {
  const { data, error } = await sb.from('recipes').update(changes)
    .eq('id', id).eq('user_id', currentUser.id).select().single();
  if (error) throw error;
  return data;
}

async function deleteRecipeFromDB(id) {
  const { error } = await sb.from('recipes').delete()
    .eq('id', id).eq('user_id', currentUser.id);
  if (error) throw error;
}

// ── MENÚ SEMANAL ─────────────────────────────────────────────

async function getMenuItems(week) {
  const { data, error } = await sb.from('menu_items').select('*')
    .eq('user_id', currentUser.id).eq('week', week);
  if (error) throw error;
  return data;
}

async function setMenuItemInDB(item) {
  item.user_id = currentUser.id;
  // Borrar slot existente, luego insertar
  await sb.from('menu_items').delete()
    .eq('user_id', currentUser.id)
    .eq('week', item.week).eq('day', item.day).eq('meal_type', item.meal_type);
  const { data, error } = await sb.from('menu_items').insert([item]).select().single();
  if (error) throw error;
  return data;
}

async function clearMenuItemInDB(id, week) {
  const { error } = await sb.from('menu_items').delete()
    .eq('id', id).eq('user_id', currentUser.id);
  if (error) throw error;
}

// ── LISTA DE LA COMPRA ────────────────────────────────────────

async function getShoppingList() {
  const { data, error } = await sb.from('shopping_list').select('*')
    .eq('user_id', currentUser.id).order('created_at');
  if (error) throw error;
  return data;
}

async function addShoppingItemToDB(item) {
  item.user_id = currentUser.id;
  const { data, error } = await sb.from('shopping_list').insert([item]).select().single();
  if (error) throw error;
  return data;
}

async function updateShoppingItemInDB(id, done) {
  const { data, error } = await sb.from('shopping_list').update({ done })
    .eq('id', id).eq('user_id', currentUser.id).select().single();
  if (error) throw error;
  return data;
}

async function deleteShoppingItemFromDB(id) {
  const { error } = await sb.from('shopping_list').delete()
    .eq('id', id).eq('user_id', currentUser.id);
  if (error) throw error;
}

async function clearCartFromDB() {
  const { error } = await sb.from('shopping_list').delete()
    .eq('user_id', currentUser.id).eq('done', true);
  if (error) throw error;
}

/* ═══════════════════════════════════════════════════
   SECCIÓN 2 — ESTADO DE LA APLICACIÓN
═══════════════════════════════════════════════════ */

const AppState = {
  activeWeek:    1,
  currentView:   'menu',
  recipes:       [],
  menuItems:     [],
  shoppingList:  [],
  selectingSlot: null,
};

const DAYS = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
const WEEKENDS = ['Sábado','Domingo'];
const MEAL_TYPES = [
  { key: 'comida', label: 'Comida', icon: `<svg viewBox="0 0 12 12" fill="none"><path d="M2 2c0 3 2 4 2 4H2v4h1.5V7h1V10H6V6S8 5 8 2H2Z" fill="currentColor" opacity=".7"/><path d="M9 2v3.5a1 1 0 0 1-1 1V10h1.5V2H9Z" fill="currentColor" opacity=".5"/></svg>` },
  { key: 'cena',   label: 'Cena',   icon: `<svg viewBox="0 0 12 12" fill="none"><path d="M6 1a5 5 0 1 0 0 10A5 5 0 0 0 6 1Zm0 1.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z" fill="currentColor" opacity=".5"/><path d="M6 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" fill="currentColor" opacity=".8"/></svg>` },
];

/* ═══════════════════════════════════════════════════
   SECCIÓN 3 — UTILIDADES
═══════════════════════════════════════════════════ */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function escapeHtml(str = '') {
  return str
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer = null;
function showToast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

function getRecipeById(id) {
  return AppState.recipes.find(r => r.id === id) || null;
}

/* ═══════════════════════════════════════════════════
   SECCIÓN 4 — CAPA DE RENDER
═══════════════════════════════════════════════════ */

function renderMenu() {
  const grid = document.getElementById('week-grid');
  grid.innerHTML = '';

  DAYS.forEach(day => {
    const isWeekend = WEEKENDS.includes(day);
    const card = document.createElement('div');
    card.className = 'day-card';

    card.innerHTML = `
      <div class="day-card-header">
        <span class="day-name">${escapeHtml(day)}</span>
        ${isWeekend ? `<span class="weekend-badge">Fin de semana</span>` : ''}
      </div>
      ${MEAL_TYPES.map(mt => {
        const menuItem = AppState.menuItems.find(
          m => m.day === day && m.meal_type === mt.key
        );
        const recipe = menuItem ? getRecipeById(menuItem.recipe_id) : null;
        return `
          <div class="meal-slot"
               data-day="${escapeHtml(day)}"
               data-meal="${mt.key}"
               data-item-id="${menuItem ? escapeHtml(menuItem.id) : ''}">
            <div class="meal-slot-label">
              ${mt.icon}
              ${escapeHtml(mt.label)}
            </div>
            ${recipe
              ? `<div class="meal-slot-content">${escapeHtml(recipe.name)}<br>
                   <span class="recipe-tag-pill">
                     <svg viewBox="0 0 10 10" fill="none" style="width:8px;height:8px"><path d="M2 5a3 3 0 1 1 6 0 3 3 0 0 1-6 0Z" stroke="currentColor" stroke-width="1.2"/></svg>
                     Receta
                   </span>
                 </div>`
              : `<div class="meal-slot-placeholder">Toca para añadir...</div>`
            }
          </div>`;
      }).join('')}
    `;

    grid.appendChild(card);
  });

  grid.querySelectorAll('.meal-slot').forEach(slot => {
    slot.addEventListener('click', () => openSelectRecipeModal(
      slot.dataset.day,
      slot.dataset.meal,
      slot.dataset.itemId
    ));
  });
}

function renderRecipes(filter = '') {
  const grid  = document.getElementById('recipes-grid');
  const lower = filter.toLowerCase();
  const list  = filter
    ? AppState.recipes.filter(r =>
        r.name.toLowerCase().includes(lower) ||
        (r.ingredients || []).some(i => i.toLowerCase().includes(lower))
      )
    : AppState.recipes;

  grid.innerHTML = '';

  if (list.length === 0) {
    grid.innerHTML = `
      <div class="empty-recipes">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style="opacity:.3;margin:0 auto;display:block">
          <circle cx="24" cy="24" r="22" stroke="#6b9e6b" stroke-width="1.5"/>
          <path d="M16 20h16M16 28h10" stroke="#6b9e6b" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <p>${filter ? 'No hay recetas que coincidan.' : 'Aún no hay recetas.<br>¡Crea la primera!'}</p>
      </div>`;
    return;
  }

  list.forEach(recipe => {
    const card = document.createElement('div');
    card.className = 'recipe-card';
    const ingrs = (recipe.ingredients || [])
      .map(i => `<span class="ingr-chip">${escapeHtml(i)}</span>`)
      .join('');

    card.innerHTML = `
      <div class="recipe-card-name">${escapeHtml(recipe.name)}</div>
      <div class="recipe-card-ingredients">${ingrs || '<span style="color:var(--text-muted);font-size:.78rem">Sin ingredientes añadidos</span>'}</div>
      ${recipe.notes ? `<div class="recipe-card-notes">${escapeHtml(recipe.notes)}</div>` : ''}
      <div class="recipe-card-actions">
        <button class="btn-icon" data-action="edit" data-id="${escapeHtml(recipe.id)}">
          <svg viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-8 8H3v-3L11 2Z" stroke="currentColor" stroke-width="1.2"/></svg>
          Editar
        </button>
        <button class="btn-icon danger" data-action="delete" data-id="${escapeHtml(recipe.id)}">
          <svg viewBox="0 0 16 16" fill="none"><path d="M4 5h8l-.8 8H4.8L4 5Z" stroke="currentColor" stroke-width="1.2"/><path d="M2 5h12M6 5V3h4v2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          Borrar
        </button>
      </div>`;

    card.querySelector('[data-action="edit"]').addEventListener('click', () => openRecipeForm(recipe.id));
    card.querySelector('[data-action="delete"]').addEventListener('click', () => handleDeleteRecipe(recipe.id));
    grid.appendChild(card);
  });
}

function renderShoppingList() {
  const pending  = AppState.shoppingList.filter(i => !i.done);
  const inCart   = AppState.shoppingList.filter(i => i.done);

  document.getElementById('pendientes-count').textContent = pending.length;
  document.getElementById('carrito-count').textContent    = inCart.length;

  const badge = document.getElementById('lista-badge');
  badge.textContent = pending.length;
  badge.style.display = pending.length > 0 ? 'grid' : 'none';

  const pendEl  = document.getElementById('list-pendientes');
  const pendEmp = document.getElementById('pendientes-empty');
  pendEl.innerHTML = '';
  if (pending.length === 0) {
    pendEmp.style.display = 'block';
  } else {
    pendEmp.style.display = 'none';
    pending.forEach(item => pendEl.appendChild(createListItemEl(item)));
  }

  const cartEl  = document.getElementById('list-carrito');
  const cartEmp = document.getElementById('carrito-empty');
  cartEl.innerHTML = '';
  if (inCart.length === 0) {
    cartEmp.style.display = 'block';
  } else {
    cartEmp.style.display = 'none';
    inCart.forEach(item => cartEl.appendChild(createListItemEl(item)));
  }
}

function createListItemEl(item) {
  const li = document.createElement('div');
  li.className = 'list-item';
  li.dataset.id = item.id;
  li.innerHTML = `
    <div class="item-check ${item.done ? 'checked' : ''}" data-action="toggle" aria-label="${item.done ? 'Desmarcar' : 'Marcar'}">
      <svg viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>
    <span class="item-name ${item.done ? 'done' : ''}">${escapeHtml(item.name)}</span>
    <button class="item-remove" data-action="remove" aria-label="Eliminar">
      <svg viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2L2 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
    </button>`;

  li.querySelector('[data-action="toggle"]').addEventListener('click', () => handleToggleItem(item.id));
  li.querySelector('[data-action="remove"]').addEventListener('click', () => handleRemoveItem(item.id));
  return li;
}

/* ═══════════════════════════════════════════════════
   SECCIÓN 5 — MODALES
═══════════════════════════════════════════════════ */

function openSelectRecipeModal(day, mealType, existingItemId) {
  AppState.selectingSlot = { day, meal_type: mealType, existingId: existingItemId };
  renderModalRecipeList('');
  document.getElementById('modal-recipe-search').value = '';
  document.getElementById('modal-select-recipe').style.display = 'flex';
  setTimeout(() => document.getElementById('modal-recipe-search').focus(), 100);
}

function closeSelectRecipeModal() {
  document.getElementById('modal-select-recipe').style.display = 'none';
  AppState.selectingSlot = null;
}

function renderModalRecipeList(filter) {
  const listEl = document.getElementById('modal-recipe-list');
  const lower  = filter.toLowerCase();
  const items  = filter
    ? AppState.recipes.filter(r => r.name.toLowerCase().includes(lower))
    : AppState.recipes;

  listEl.innerHTML = '';
  if (items.length === 0) {
    listEl.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:20px;font-size:.875rem">
      ${filter ? 'Sin resultados.' : 'No hay recetas creadas todavía.'}</p>`;
    return;
  }
  items.forEach(r => {
    const el = document.createElement('div');
    el.className = 'modal-recipe-item';
    el.innerHTML = `
      <div class="mri-name">${escapeHtml(r.name)}</div>
      ${r.ingredients?.length ? `<div class="mri-ingr">${escapeHtml(r.ingredients.slice(0,4).join(', '))}${r.ingredients.length>4?'…':''}</div>` : ''}`;
    el.addEventListener('click', () => handleSelectRecipeForSlot(r.id));
    listEl.appendChild(el);
  });
}

async function handleSelectRecipeForSlot(recipeId) {
  const { day, meal_type, existingId } = AppState.selectingSlot;
  const item = {
    id:         existingId || uid(),
    week:       AppState.activeWeek,
    day,
    meal_type,
    recipe_id:  recipeId,
  };
  try {
    await setMenuItemInDB(item);
    const idx = AppState.menuItems.findIndex(
      m => m.day === day && m.meal_type === meal_type
    );
    if (idx === -1) AppState.menuItems.push(item);
    else AppState.menuItems[idx] = item;
    renderMenu();
    closeSelectRecipeModal();
    showToast('Plato asignado ✓');
  } catch (e) {
    console.error(e);
    showToast('Error al guardar 😕');
  }
}

async function handleClearSlot() {
  const { existingId } = AppState.selectingSlot;
  if (!existingId) { closeSelectRecipeModal(); return; }
  try {
    await clearMenuItemInDB(existingId, AppState.activeWeek);
    AppState.menuItems = AppState.menuItems.filter(m => m.id !== existingId);
    renderMenu();
    closeSelectRecipeModal();
    showToast('Plato eliminado');
  } catch (e) {
    console.error(e);
    showToast('Error al eliminar 😕');
  }
}

// ── Modal: Nueva / Editar receta ────────────────────────

let tempIngredients = [];

function openRecipeForm(recipeId = null) {
  const recipe = recipeId ? AppState.recipes.find(r => r.id === recipeId) : null;
  tempIngredients = recipe ? [...(recipe.ingredients || [])] : [];

  document.getElementById('recipe-form-title').textContent = recipe ? 'Editar receta' : 'Nueva receta';
  document.getElementById('recipe-id').value    = recipe?.id || '';
  document.getElementById('recipe-name').value  = recipe?.name || '';
  document.getElementById('recipe-notes').value = recipe?.notes || '';
  document.getElementById('ingredient-input').value = '';

  renderIngredientTags();
  document.getElementById('modal-recipe-form').style.display = 'flex';
  setTimeout(() => document.getElementById('recipe-name').focus(), 100);
}

function closeRecipeForm() {
  document.getElementById('modal-recipe-form').style.display = 'none';
}

function renderIngredientTags() {
  const container = document.getElementById('ingredients-list');
  container.innerHTML = '';
  tempIngredients.forEach((ing, idx) => {
    const tag = document.createElement('div');
    tag.className = 'ingr-tag';
    tag.innerHTML = `
      <span>${escapeHtml(ing)}</span>
      <button type="button" aria-label="Eliminar ingrediente" data-idx="${idx}">
        <svg viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
      </button>`;
    tag.querySelector('button').addEventListener('click', () => {
      tempIngredients.splice(idx, 1);
      renderIngredientTags();
    });
    container.appendChild(tag);
  });
}

function addTempIngredient() {
  const input = document.getElementById('ingredient-input');
  const raw   = input.value.trim();
  if (!raw) return;
  raw.split(',').map(s => s.trim()).filter(Boolean).forEach(s => {
    if (!tempIngredients.includes(s)) tempIngredients.push(s);
  });
  input.value = '';
  renderIngredientTags();
}

async function handleSaveRecipe() {
  const id    = document.getElementById('recipe-id').value;
  const name  = document.getElementById('recipe-name').value.trim();
  const notes = document.getElementById('recipe-notes').value.trim();
  if (!name) { showToast('El nombre es obligatorio'); return; }

  const recipe = { id: id || uid(), name, ingredients: [...tempIngredients], notes };

  try {
    if (id) {
      await updateRecipeInDB(id, { name, ingredients: recipe.ingredients, notes });
      const idx = AppState.recipes.findIndex(r => r.id === id);
      if (idx !== -1) AppState.recipes[idx] = { ...AppState.recipes[idx], ...recipe };
    } else {
      await addRecipeToDB(recipe);
      AppState.recipes.push(recipe);
    }
    renderRecipes(document.getElementById('receta-search').value);
    closeRecipeForm();
    showToast(id ? 'Receta actualizada ✓' : 'Receta creada ✓');
  } catch (e) {
    console.error(e);
    showToast('Error al guardar 😕');
  }
}

async function handleDeleteRecipe(id) {
  if (!confirm('¿Eliminar esta receta? Los platos del menú que la usen quedarán vacíos.')) return;
  try {
    await deleteRecipeFromDB(id);
    AppState.recipes = AppState.recipes.filter(r => r.id !== id);
    AppState.menuItems = AppState.menuItems.filter(m => m.recipe_id !== id);
    renderRecipes(document.getElementById('receta-search').value);
    renderMenu();
    showToast('Receta eliminada');
  } catch (e) {
    console.error(e);
    showToast('Error al eliminar 😕');
  }
}

/* ═══════════════════════════════════════════════════
   SECCIÓN 6 — LISTA DE LA COMPRA: ACCIONES
═══════════════════════════════════════════════════ */

async function handleAddProduct() {
  const input = document.getElementById('nuevo-producto');
  const name  = input.value.trim();
  if (!name) return;
  const item = { id: uid(), name, done: false };
  try {
    await addShoppingItemToDB(item);
    AppState.shoppingList.push(item);
    input.value = '';
    renderShoppingList();
  } catch (e) {
    console.error(e);
    showToast('Error al añadir 😕');
  }
}

async function handleToggleItem(id) {
  const item = AppState.shoppingList.find(i => i.id === id);
  if (!item) return;
  const newDone = !item.done;
  try {
    await updateShoppingItemInDB(id, newDone);
    item.done = newDone;
    renderShoppingList();
  } catch (e) {
    console.error(e);
    showToast('Error 😕');
  }
}

async function handleRemoveItem(id) {
  try {
    await deleteShoppingItemFromDB(id);
    AppState.shoppingList = AppState.shoppingList.filter(i => i.id !== id);
    renderShoppingList();
  } catch (e) {
    console.error(e);
    showToast('Error al eliminar 😕');
  }
}

async function handleClearCart() {
  const count = AppState.shoppingList.filter(i => i.done).length;
  if (count === 0) { showToast('El carrito ya está vacío'); return; }
  if (!confirm(`¿Vaciar ${count} producto${count > 1 ? 's' : ''} del carrito?`)) return;
  try {
    await clearCartFromDB();
    AppState.shoppingList = AppState.shoppingList.filter(i => !i.done);
    renderShoppingList();
    showToast('Carrito vaciado');
  } catch (e) {
    console.error(e);
    showToast('Error 😕');
  }
}

async function handleCargarIngredientes() {
  const week = AppState.activeWeek;
  const weekItems = AppState.menuItems.filter(m => m.week === week);
  if (weekItems.length === 0) {
    showToast('La semana activa no tiene platos asignados');
    return;
  }

  const allIngredients = [];
  weekItems.forEach(mi => {
    const recipe = getRecipeById(mi.recipe_id);
    if (recipe?.ingredients) allIngredients.push(...recipe.ingredients);
  });

  if (allIngredients.length === 0) {
    showToast('Las recetas del menú no tienen ingredientes definidos');
    return;
  }

  const existing = new Set(
    AppState.shoppingList.map(i => i.name.toLowerCase().trim())
  );
  const toAdd = [...new Set(allIngredients.map(i => i.trim()))]
    .filter(i => !existing.has(i.toLowerCase()));

  if (toAdd.length === 0) {
    showToast('Todos los ingredientes ya están en la lista ✓');
    return;
  }

  try {
    for (const name of toAdd) {
      const item = { id: uid(), name, done: false };
      await addShoppingItemToDB(item);
      AppState.shoppingList.push(item);
    }
    renderShoppingList();
    showToast(`${toAdd.length} ingrediente${toAdd.length > 1 ? 's' : ''} añadido${toAdd.length > 1 ? 's' : ''} ✓`);
  } catch (e) {
    console.error(e);
    showToast('Error al cargar ingredientes 😕');
  }
}

/* ═══════════════════════════════════════════════════
   SECCIÓN 7 — NAVEGACIÓN Y VISTAS
═══════════════════════════════════════════════════ */

function switchView(viewName) {
  AppState.currentView = viewName;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${viewName}`).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === viewName));
  document.getElementById('week-bar').style.display =
    viewName === 'menu' ? 'block' : 'none';
}

async function switchWeek(week) {
  AppState.activeWeek = week;
  document.querySelectorAll('.week-tab').forEach(t =>
    t.classList.toggle('active', Number(t.dataset.week) === week)
  );
  try {
    AppState.menuItems = await getMenuItems(week);
    renderMenu();
  } catch (e) {
    console.error(e);
    showToast('Error al cargar la semana 😕');
  }
}

/* ═══════════════════════════════════════════════════
   SECCIÓN 8 — INICIALIZACIÓN
═══════════════════════════════════════════════════ */

async function initApp() {
  try {
    const [recipes, menuItems, shoppingList] = await Promise.all([
      getRecipes(),
      getMenuItems(AppState.activeWeek),
      getShoppingList(),
    ]);
    AppState.recipes      = recipes;
    AppState.menuItems    = menuItems;
    AppState.shoppingList = shoppingList;
  } catch (e) {
    console.error('Error al inicializar datos:', e);
  }

  renderMenu();
  renderRecipes();
  renderShoppingList();
  switchView('menu');
}

function bindListeners() {
  // Navegación
  document.querySelectorAll('.nav-btn[data-view]').forEach(btn =>
    btn.addEventListener('click', () => switchView(btn.dataset.view))
  );
  document.querySelectorAll('.week-tab').forEach(tab =>
    tab.addEventListener('click', () => switchWeek(Number(tab.dataset.week)))
  );

  // Recetas
  document.getElementById('btn-nueva-receta').addEventListener('click', () => openRecipeForm());
  document.getElementById('receta-search').addEventListener('input', e =>
    renderRecipes(e.target.value)
  );
  document.getElementById('btn-add-ingredient').addEventListener('click', addTempIngredient);
  document.getElementById('ingredient-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addTempIngredient(); }
  });
  document.getElementById('btn-save-recipe').addEventListener('click', handleSaveRecipe);
  document.getElementById('btn-cancel-recipe').addEventListener('click', closeRecipeForm);
  document.getElementById('close-recipe-form').addEventListener('click', closeRecipeForm);

  // Modal selección
  document.getElementById('close-select-recipe').addEventListener('click', closeSelectRecipeModal);
  document.getElementById('btn-clear-slot').addEventListener('click', handleClearSlot);
  document.getElementById('modal-recipe-search').addEventListener('input', e =>
    renderModalRecipeList(e.target.value)
  );

  // Lista
  document.getElementById('btn-add-producto').addEventListener('click', handleAddProduct);
  document.getElementById('nuevo-producto').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleAddProduct();
  });
  document.getElementById('btn-vaciar').addEventListener('click', handleClearCart);
  document.getElementById('btn-cargar-semana').addEventListener('click', handleCargarIngredientes);

  // Cerrar modales
  document.getElementById('modal-select-recipe').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeSelectRecipeModal();
  });
  document.getElementById('modal-recipe-form').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeRecipeForm();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeSelectRecipeModal();
      closeRecipeForm();
    }
  });

  // Auth
  document.getElementById('btn-auth-submit').addEventListener('click', handleAuthSubmit);
  document.getElementById('auth-email').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('auth-password').focus();
  });
  document.getElementById('auth-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleAuthSubmit();
  });
  document.getElementById('btn-google').addEventListener('click', handleGoogleLogin);
  document.getElementById('btn-auth-toggle').addEventListener('click', toggleAuthMode);

  // User menu
  document.getElementById('btn-user-menu').addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = document.getElementById('user-dropdown');
    dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
  });
  document.addEventListener('click', () => {
    document.getElementById('user-dropdown').style.display = 'none';
  });
  document.getElementById('user-dropdown').addEventListener('click', e => e.stopPropagation());
  document.getElementById('btn-logout').addEventListener('click', handleLogout);
}

// ── Arranque ──────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  bindListeners();

  // Escuchar cambios de sesión
  sb.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      showApp(session.user);
      await initApp();
    } else {
      showAuth();
    }
  });
});
