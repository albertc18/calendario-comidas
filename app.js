/* ═══════════════════════════════════════════════════════════════
   MEALPLANNER — app.js
   ─────────────────────────────────────────────────────────────
   Arquitectura:
   ① Capa DB → funciones async que puedes reemplazar con Supabase
   ② Capa Estado (AppState) → fuente única de verdad en memoria
   ③ Capa Render → funciones que pintan el DOM desde el estado
   ④ Capa Eventos → listeners que llaman a DB → actualizan estado → renderizan
═══════════════════════════════════════════════════════════════ */

'use strict';

/* ═══════════════════════════════════════════════════
   SECCIÓN 0 — CONFIGURACIÓN SUPABASE
   ═══════════════════════════════════════════════════
   Cuando tengas tu proyecto Supabase listo:
   1. Instala: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js/dist/umd/supabase.js"></script>
      (añade en index.html ANTES de este script)
   2. Rellena las dos constantes de abajo con tus credenciales
   3. Cambia USE_SUPABASE a true
   4. Las tablas necesarias en Supabase:
      - recipes      (id uuid PK, name text, ingredients jsonb[], notes text, created_at timestamptz)
      - menu_items   (id uuid PK, week int, day text, meal_type text, recipe_id uuid FK->recipes, created_at timestamptz)
      - shopping_list(id uuid PK, name text, done bool default false, created_at timestamptz)
═══════════════════════════════════════════════════ */

const SUPABASE_URL    = 'https://nbcswsaqppckctwdeshy.supabase.co';   // ← reemplaza
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5iY3N3c2FxcHBja2N0d2Rlc2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxMjIwNTgsImV4cCI6MjA5MDY5ODA1OH0.-2JVxBb1wbypEpr_Y_TbCaHQkF8ayYpQL7_uI2l2Gr0';                     // ← reemplaza
const USE_SUPABASE    = true;                                // ← cambia a true cuando estés listo

// Inicialización del cliente (se activa solo si USE_SUPABASE = true)
let sb = null;
if (USE_SUPABASE && typeof window.supabase !== 'undefined') {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/* ═══════════════════════════════════════════════════
   SECCIÓN 1 — CAPA DE BASE DE DATOS
   ═══════════════════════════════════════════════════
   Cada función tiene dos ramas:
   → Si USE_SUPABASE=true  → llama a Supabase
   → Si USE_SUPABASE=false → usa localStorage como fallback
═══════════════════════════════════════════════════ */

// ── LocalStorage helpers (fallback) ─────────────────────────
const LS = {
  get: (key, def = []) => { try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; } },
  set: (key, val)       => localStorage.setItem(key, JSON.stringify(val)),
};

// ── RECETAS ──────────────────────────────────────────────────

/**
 * Obtiene todas las recetas guardadas.
 * @returns {Promise<Array>} lista de objetos receta
 */
async function getRecipes() {
  if (USE_SUPABASE) {
    const { data, error } = await sb.from('recipes').select('*').order('created_at');
    if (error) throw error;
    return data;
  }
  return LS.get('mp_recipes', []);
}

/**
 * Guarda una nueva receta.
 * @param {{ id:string, name:string, ingredients:string[], notes:string }} recipe
 * @returns {Promise<object>} receta guardada
 */
async function addRecipeToDB(recipe) {
  if (USE_SUPABASE) {
    const { data, error } = await sb.from('recipes').insert([recipe]).select().single();
    if (error) throw error;
    return data;
  }
  const list = LS.get('mp_recipes', []);
  list.push(recipe);
  LS.set('mp_recipes', list);
  return recipe;
}

/**
 * Actualiza una receta existente por su id.
 * @param {string} id
 * @param {{ name?:string, ingredients?:string[], notes?:string }} changes
 * @returns {Promise<object>} receta actualizada
 */
async function updateRecipeInDB(id, changes) {
  if (USE_SUPABASE) {
    const { data, error } = await sb.from('recipes').update(changes).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }
  const list = LS.get('mp_recipes', []);
  const idx  = list.findIndex(r => r.id === id);
  if (idx === -1) throw new Error('Receta no encontrada');
  list[idx] = { ...list[idx], ...changes };
  LS.set('mp_recipes', list);
  return list[idx];
}

/**
 * Elimina una receta por su id.
 * @param {string} id
 * @returns {Promise<void>}
 */
async function deleteRecipeFromDB(id) {
  if (USE_SUPABASE) {
    const { error } = await sb.from('recipes').delete().eq('id', id);
    if (error) throw error;
    return;
  }
  const list = LS.get('mp_recipes', []).filter(r => r.id !== id);
  LS.set('mp_recipes', list);
}

// ── MENÚ SEMANAL ─────────────────────────────────────────────

/**
 * Obtiene los platos asignados a la semana indicada.
 * @param {number} week  1-4
 * @returns {Promise<Array>} lista de {id, week, day, meal_type, recipe_id}
 */
async function getMenuItems(week) {
  if (USE_SUPABASE) {
    const { data, error } = await sb.from('menu_items').select('*').eq('week', week);
    if (error) throw error;
    return data;
  }
  return LS.get(`mp_menu_w${week}`, []);
}

/**
 * Asigna un plato a un slot del menú (o lo actualiza si ya existía).
 * @param {{ id:string, week:number, day:string, meal_type:string, recipe_id:string }} item
 * @returns {Promise<object>}
 */
async function setMenuItemInDB(item) {
  if (USE_SUPABASE) {
    // Upsert: si ya existe ese (week, day, meal_type) lo reemplaza
    const { data, error } = await supabase
      .from('menu_items')
      .upsert([item], { onConflict: 'week,day,meal_type' })
      .select().single();
    if (error) throw error;
    return data;
  }
  const key  = `mp_menu_w${item.week}`;
  const list = LS.get(key, []);
  const idx  = list.findIndex(m => m.day === item.day && m.meal_type === item.meal_type);
  if (idx === -1) list.push(item); else list[idx] = item;
  LS.set(key, list);
  return item;
}

/**
 * Elimina el plato de un slot (deja el hueco vacío).
 * @param {string} id  id del menu_item
 * @param {number} week
 * @returns {Promise<void>}
 */
async function clearMenuItemInDB(id, week) {
  if (USE_SUPABASE) {
    const { error } = await sb.from('menu_items').delete().eq('id', id);
    if (error) throw error;
    return;
  }
  const key  = `mp_menu_w${week}`;
  const list = LS.get(key, []).filter(m => m.id !== id);
  LS.set(key, list);
}

// ── LISTA DE LA COMPRA ────────────────────────────────────────

/**
 * Obtiene todos los items de la lista de la compra.
 * @returns {Promise<Array>} lista de {id, name, done}
 */
async function getShoppingList() {
  if (USE_SUPABASE) {
    const { data, error } = await sb.from('shopping_list').select('*').order('created_at');
    if (error) throw error;
    return data;
  }
  return LS.get('mp_shopping', []);
}

/**
 * Añade un producto a la lista de la compra.
 * @param {{ id:string, name:string, done:boolean }} item
 * @returns {Promise<object>}
 */
async function addShoppingItemToDB(item) {
  if (USE_SUPABASE) {
    const { data, error } = await sb.from('shopping_list').insert([item]).select().single();
    if (error) throw error;
    return data;
  }
  const list = LS.get('mp_shopping', []);
  list.push(item);
  LS.set('mp_shopping', list);
  return item;
}

/**
 * Actualiza el estado (done) de un producto.
 * @param {string} id
 * @param {boolean} done
 * @returns {Promise<object>}
 */
async function updateShoppingItemInDB(id, done) {
  if (USE_SUPABASE) {
    const { data, error } = await sb.from('shopping_list').update({ done }).eq('id', id).select().single();
    if (error) throw error;
    return data;
  }
  const list = LS.get('mp_shopping', []);
  const idx  = list.findIndex(i => i.id === id);
  if (idx !== -1) list[idx].done = done;
  LS.set('mp_shopping', list);
  return list[idx];
}

/**
 * Elimina un producto de la lista.
 * @param {string} id
 * @returns {Promise<void>}
 */
async function deleteShoppingItemFromDB(id) {
  if (USE_SUPABASE) {
    const { error } = await sb.from('shopping_list').delete().eq('id', id);
    if (error) throw error;
    return;
  }
  const list = LS.get('mp_shopping', []).filter(i => i.id !== id);
  LS.set('mp_shopping', list);
}

/**
 * Elimina todos los productos marcados como "done" (en el carrito).
 * @returns {Promise<void>}
 */
async function clearCartFromDB() {
  if (USE_SUPABASE) {
    const { error } = await sb.from('shopping_list').delete().eq('done', true);
    if (error) throw error;
    return;
  }
  const list = LS.get('mp_shopping', []).filter(i => !i.done);
  LS.set('mp_shopping', list);
}

/* ═══════════════════════════════════════════════════
   SECCIÓN 2 — ESTADO DE LA APLICACIÓN
═══════════════════════════════════════════════════ */

const AppState = {
  activeWeek:    1,          // semana activa (1-4)
  currentView:   'menu',     // 'menu' | 'recetas' | 'lista'
  recipes:       [],         // Array<{ id, name, ingredients[], notes }>
  menuItems:     [],         // Array<{ id, week, day, meal_type, recipe_id }>
  shoppingList:  [],         // Array<{ id, name, done }>
  // contexto temporal para el modal de selección de receta
  selectingSlot: null,       // { day, meal_type, existingId }
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

// ── 4.1 MENÚ SEMANAL ─────────────────────────────────────────

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

  // Listeners en slots
  grid.querySelectorAll('.meal-slot').forEach(slot => {
    slot.addEventListener('click', () => openSelectRecipeModal(
      slot.dataset.day,
      slot.dataset.meal,
      slot.dataset.itemId
    ));
  });
}

// ── 4.2 RECETAS ───────────────────────────────────────────────

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

// ── 4.3 LISTA DE LA COMPRA ────────────────────────────────────

function renderShoppingList() {
  const pending  = AppState.shoppingList.filter(i => !i.done);
  const inCart   = AppState.shoppingList.filter(i => i.done);

  // Contadores
  document.getElementById('pendientes-count').textContent = pending.length;
  document.getElementById('carrito-count').textContent    = inCart.length;

  // Badge header
  const badge = document.getElementById('lista-badge');
  badge.textContent = pending.length;
  badge.style.display = pending.length > 0 ? 'grid' : 'none';

  // Pendientes
  const pendEl  = document.getElementById('list-pendientes');
  const pendEmp = document.getElementById('pendientes-empty');
  pendEl.innerHTML = '';
  if (pending.length === 0) {
    pendEmp.style.display = 'block';
  } else {
    pendEmp.style.display = 'none';
    pending.forEach(item => pendEl.appendChild(createListItemEl(item)));
  }

  // En el carrito
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

// ── 5.1 Modal: Seleccionar receta para el menú ───────────────

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
    // Actualizar estado local
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

// ── 5.2 Modal: Nueva / Editar receta ────────────────────────

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
  // Permite introducir varios separados por coma
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
    // También quitamos del menú
    AppState.menuItems = AppState.menuItems.filter(m => m.recipe_id !== id);
    for (let w = 1; w <= 4; w++) {
      const list = LS.get(`mp_menu_w${w}`, []).filter(m => m.recipe_id !== id);
      LS.set(`mp_menu_w${w}`, list);
    }
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

/**
 * Lee los platos de la semana activa,
 * extrae todos sus ingredientes y los añade a la lista
 * eliminando duplicados (case-insensitive) con los ya existentes.
 */
async function handleCargarIngredientes() {
  const week = AppState.activeWeek;
  const weekItems = AppState.menuItems.filter(m => m.week === week);
  if (weekItems.length === 0) {
    showToast('La semana activa no tiene platos asignados');
    return;
  }

  // Recoger todos los ingredientes de las recetas del menú
  const allIngredients = [];
  weekItems.forEach(mi => {
    const recipe = getRecipeById(mi.recipe_id);
    if (recipe?.ingredients) allIngredients.push(...recipe.ingredients);
  });

  if (allIngredients.length === 0) {
    showToast('Las recetas del menú no tienen ingredientes definidos');
    return;
  }

  // Eliminar duplicados considerando lo que ya está en lista
  const existing = new Set(
    AppState.shoppingList.map(i => i.name.toLowerCase().trim())
  );
  const toAdd = [...new Set(allIngredients.map(i => i.trim()))]
    .filter(i => !existing.has(i.toLowerCase()));

  if (toAdd.length === 0) {
    showToast('Todos los ingredientes ya están en la lista ✓');
    return;
  }

  // Añadir a la DB y al estado
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

  // La barra de semana sólo es visible en menú
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

async function init() {
  try {
    // Cargar datos iniciales en paralelo
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

  // Render inicial
  renderMenu();
  renderRecipes();
  renderShoppingList();
  switchView('menu');

  // ── Listeners de navegación ────────────────────────────────
  document.querySelectorAll('.nav-btn').forEach(btn =>
    btn.addEventListener('click', () => switchView(btn.dataset.view))
  );

  document.querySelectorAll('.week-tab').forEach(tab =>
    tab.addEventListener('click', () => switchWeek(Number(tab.dataset.week)))
  );

  // ── Listeners: Recetas ─────────────────────────────────────
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

  // ── Listeners: Modal selección receta ────────────────────────
  document.getElementById('close-select-recipe').addEventListener('click', closeSelectRecipeModal);
  document.getElementById('btn-clear-slot').addEventListener('click', handleClearSlot);
  document.getElementById('modal-recipe-search').addEventListener('input', e =>
    renderModalRecipeList(e.target.value)
  );

  // ── Listeners: Lista de la compra ─────────────────────────
  document.getElementById('btn-add-producto').addEventListener('click', handleAddProduct);
  document.getElementById('nuevo-producto').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleAddProduct();
  });
  document.getElementById('btn-vaciar').addEventListener('click', handleClearCart);
  document.getElementById('btn-cargar-semana').addEventListener('click', handleCargarIngredientes);

  // ── Cerrar modales al hacer clic fuera ──────────────────────
  document.getElementById('modal-select-recipe').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeSelectRecipeModal();
  });
  document.getElementById('modal-recipe-form').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeRecipeForm();
  });

  // ── Tecla Escape cierra modales ────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeSelectRecipeModal();
      closeRecipeForm();
    }
  });

  // ── Datos de muestra si la app está vacía ──────────────────
  if (AppState.recipes.length === 0) loadSampleData();
}

/* ═══════════════════════════════════════════════════
   SECCIÓN 9 — DATOS DE MUESTRA (DEMO)
   Se cargan solo si no hay recetas guardadas.
   Puedes borrar este bloque una vez tengas datos reales.
═══════════════════════════════════════════════════ */

async function loadSampleData() {
  const sampleRecipes = [
    {
      id: uid(),
      name: 'Pastel de pastanaga sin gluten y sin leche',
      ingredients: ['Zanahorias', 'Huevos', 'Harina sin gluten', 'Aceite vegetal', 'Azúcar', 'Bicarbonato', 'Canela'],
      notes: 'Horno a 180°C durante 35 min.',
    },
    {
      id: uid(),
      name: 'Arroz con verduras',
      ingredients: ['Arroz', 'Pimiento', 'Cebolla', 'Zanahoria', 'Aceite de oliva', 'Caldo de verduras'],
      notes: '',
    },
    {
      id: uid(),
      name: 'Lentejas estofadas',
      ingredients: ['Lentejas', 'Patata', 'Zanahoria', 'Cebolla', 'Tomate', 'Pimentón ahumado', 'Aceite de oliva'],
      notes: 'Cocer 30 min en olla normal.',
    },
  ];

  for (const r of sampleRecipes) {
    await addRecipeToDB(r);
    AppState.recipes.push(r);
  }

  // Asignar el primer plato al Lunes comida semana 1
  const item = {
    id: uid(),
    week: 1,
    day: 'Lunes',
    meal_type: 'comida',
    recipe_id: sampleRecipes[0].id,
  };
  await setMenuItemInDB(item);
  AppState.menuItems.push(item);

  // Lista de muestra
  const shopItems = [
    { id: uid(), name: 'Zanahorias', done: false },
    { id: uid(), name: 'Huevos',     done: false },
    { id: uid(), name: 'Aceite vegetal', done: false },
    { id: uid(), name: 'Harina sin gluten', done: true },
    { id: uid(), name: 'Azúcar',     done: true },
  ];
  for (const si of shopItems) {
    await addShoppingItemToDB(si);
    AppState.shoppingList.push(si);
  }

  renderMenu();
  renderRecipes();
  renderShoppingList();
}

// ── Arranque ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
