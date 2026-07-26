// ============================================================
// CONFIG - UPDATE THESE WITH YOUR SUPABASE PROJECT DETAILS
// ============================================================
const SB_URL = 'https://aajkbqmzuqfzzugjmerp.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhamticW16dXFmenp1Z2ptZXJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzOTYwNTgsImV4cCI6MjA5ODk3MjA1OH0.x9c12iuhC2DNXyHGSixFK1j58wMrN7ZJbrSgG2dsrGA';
// ============================================================

// Cookie storage so OAuth sessions work in iOS standalone PWA mode
// (iOS Safari and WKWebView share cookies but NOT localStorage)
const cookieStorage = {
  getItem(key) {
    const match = document.cookie.split('; ').find(r => r.startsWith(key + '='));
    return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : null;
  },
  setItem(key, value) {
    const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = `${key}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax; Secure`;
  },
  removeItem(key) {
    document.cookie = `${key}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Lax; Secure`;
  }
};

const sb = supabase.createClient(SB_URL, SB_KEY, {
  auth: {
    flowType: 'implicit',
    storage: cookieStorage,
    persistSession: true,
    detectSessionInUrl: true
  }
});

// Trending 2026 hashtag sets (5 per post - Instagram cap)
const TAGS = [
  '#MessinaGlam #GlazedDonutSkin #SoftGlam #LuxuryBeauty #GlowySkin',
  '#MessinaGlam #GlassSkin #CleanGirlAesthetic #LuxuryBeauty #SoftGlam',
  '#MessinaGlam #LatteMakeup #BronzedGlow #LuxuryBeauty #SoftGlam',
  '#MessinaGlam #GlazedDonutSkin #GlossyLips #LuxuryBeauty #GlowUp',
  '#MessinaGlam #GlassSkin #SoftGlam #LuxuryBeauty #CleanGirlAesthetic'
];

const DEFAULT_CAPTIONS = [
  "Elevate your routine with the look that turns heads. Every detail is designed for the woman who demands more. Link in bio. ✨",
  "Luxury is not just a price point, it is a feeling. Wear it. Own it. Link in bio. 💎",
  "Your glow era starts here. Premium beauty, effortless results. Link in bio. ✨",
  "The secret to looking this good? We will let the results speak for themselves. Link in bio. 💫",
  "Crafted for women who know exactly what they want. Link in bio. 💎"
];

// App state
let user = null;
let pendingNewUserOnboard = false;
let photos = [];
let schedCfg = { days: [2, 4], time: '09:00', tz: Intl.DateTimeFormat().resolvedOptions().timeZone, weeks: 12, recycle: false, platform: 'instagram' };
let previewSlots = [];
let randPhotos = [];
let randOrder = [];
let imgCache = new Map();
let mediaLibrary = []; // { id, url, thumbnailUrl, fileType, fileName }

// ---- SCREENS ----
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  el.classList.add('active');
  el.scrollTop = 0;
}

// ---- TOAST ----
let toastTimer;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ---- AUTH ----
async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;
  if (!email || !pass) { toast('Enter your email and password', 'error'); return; }
  const btn = document.getElementById('login-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  btn.disabled = false; btn.textContent = 'Sign In';
  if (error) { toast(error.message, 'error'); return; }
  user = data.user;
  initApp();
}

async function doSignup() {
  const name  = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const pass  = document.getElementById('signup-pass').value;
  if (!name || !email || !pass) { toast('Fill in all fields', 'error'); return; }
  if (pass.length < 8) { toast('Password must be 8+ characters', 'error'); return; }
  const btn = document.getElementById('signup-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  // Set flag BEFORE the async call so auth listener fires with correct state
  pendingNewUserOnboard = true;
  localStorage.removeItem('postaway_onboarded');
  const { data, error } = await sb.auth.signUp({
    email, password: pass,
    options: {
      data: { full_name: name },
      emailRedirectTo: 'https://www.getpostaway.com'
    }
  });
  btn.disabled = false; btn.textContent = 'Create Account';
  if (error) { pendingNewUserOnboard = false; toast(error.message, 'error'); return; }
  if (data.user && !data.session) {
    pendingNewUserOnboard = false;
    toast('Check your email to confirm your account', 'success');
    showScreen('screen-login');
  } else {
    user = data.user;
    initApp(true);
  }
}

async function doForgot() {
  const email = document.getElementById('forgot-email').value.trim();
  if (!email) { toast('Enter your email', 'error'); return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: 'https://getpostaway.com' });
  if (error) { toast(error.message, 'error'); return; }
  toast('Reset link sent - check your email', 'success');
  showScreen('screen-login');
}

async function doSignout() {
  await sb.auth.signOut();
  user = null;
  photos = [];
  showScreen('screen-landing');
}

// ---- ONBOARDING ----
let obCurrent = 0;
const OB_TOTAL = 5;

function obNext() {
  if (obCurrent < OB_TOTAL - 1) {
    document.getElementById('ob-' + obCurrent).style.display = 'none';
    document.querySelectorAll('.ob-dot')[obCurrent].classList.remove('active');
    obCurrent++;
    const slide = document.getElementById('ob-' + obCurrent);
    slide.style.display = 'flex';
    slide.style.flexDirection = 'column';
    document.querySelectorAll('.ob-dot')[obCurrent].classList.add('active');
    if (obCurrent === OB_TOTAL - 1) {
      document.getElementById('ob-next-btn').textContent = 'Get Started';
      document.getElementById('ob-next-btn').onclick = finishOnboarding;
    }
  } else {
    finishOnboarding();
  }
}

function finishOnboarding() {
  localStorage.setItem('postaway_onboarded', '1');
  showScreen('screen-app');
}

// ---- INIT APP ----
async function initApp(isNewUser = false) {
  pendingNewUserOnboard = false; // Clear regardless of how initApp was triggered
  const onboarded = localStorage.getItem('postaway_onboarded');
  if (!onboarded || isNewUser) {
    showScreen('screen-onboarding');
  } else {
    showScreen('screen-app');
  }
  populateTZ();

  const meta = user.user_metadata || {};
  const name = meta.full_name || user.email.split('@')[0];
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  document.getElementById('nav-avatar').textContent    = initials;
  document.getElementById('profile-avatar').textContent = initials;
  document.getElementById('profile-name').textContent  = name;
  document.getElementById('profile-email').textContent = user.email;

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  document.getElementById('greeting-name').textContent = greet + ', ' + name.split(' ')[0];

  // Restore saved AI provider + key
  const savedProvider = localStorage.getItem('pf_ai_provider') || 'claude';
  setAIProvider(savedProvider);

  // Load media library
  loadMediaLibrary();

  // Handle return from OAuth (Instagram, etc.)
  handleOAuthReturn();

  // Render connected account statuses
  renderConnectedAccounts();

  await loadDashboard();
}

// ---- DASHBOARD ----
async function loadDashboard() {
  const { data } = await sb.from('posts')
    .select('id,status,image_url,content,scheduled_at')
    .eq('user_id', user.id)
    .order('scheduled_at', { ascending: true });

  if (!data) return;

  const scheduled = data.filter(p => p.status === 'scheduled');
  const published = data.filter(p => p.status === 'published');

  document.getElementById('stat-scheduled').textContent = scheduled.length;
  document.getElementById('stat-published').textContent = published.length;

  const list = document.getElementById('upcoming-list');
  if (scheduled.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="big">✦</div>
        <p>No posts scheduled yet.<br>Tap Schedule to get started.</p>
        <button class="btn btn-gold" style="width:auto;padding:12px 24px" onclick="switchTab('schedule')">Schedule Posts</button>
      </div>`;
    return;
  }

  list.innerHTML = scheduled.slice(0, 10).map(p => {
    const d = new Date(p.scheduled_at);
    const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `<div class="post-card">
      <div class="post-thumb">${p.image_url ? `<img src="${p.image_url}" loading="lazy">` : '🖼'}</div>
      <div class="post-info">
        <div class="post-caption">${p.content || ''}</div>
        <div class="post-meta">${date} at ${time}</div>
      </div>
      <div class="post-status status-scheduled">Scheduled</div>
    </div>`;
  }).join('');
}

// ---- SCHEDULE TAB POSTS LIST ----
async function loadSchedPostsList() {
  const listEl = document.getElementById('sched-posts-list');
  const itemsEl = document.getElementById('sched-posts-items');
  if (!listEl || !itemsEl || !user) return;
  const { data } = await sb.from('posts')
    .select('id,status,image_url,content,scheduled_at')
    .eq('user_id', user.id)
    .eq('status', 'scheduled')
    .order('scheduled_at', { ascending: true })
    .limit(5);
  if (data && data.length > 0) {
    listEl.style.display = 'block';
    itemsEl.innerHTML = data.map(p => {
      const d = new Date(p.scheduled_at);
      const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return `<div class="post-card" style="margin-bottom:8px">
        <div class="post-thumb">${p.image_url ? `<img src="${p.image_url}" loading="lazy">` : '<div style="width:100%;height:100%;background:var(--surface);display:flex;align-items:center;justify-content:center;font-size:18px">📷</div>'}</div>
        <div class="post-info">
          <div class="post-caption">${p.content ? p.content.slice(0, 60) + (p.content.length > 60 ? '...' : '') : 'No caption'}</div>
          <div class="post-meta">${date} at ${time}</div>
        </div>
        <div class="post-status status-scheduled">Scheduled</div>
      </div>`;
    }).join('');
  } else {
    listEl.style.display = 'none';
  }
}

// ---- MEDIA LIBRARY ----
async function loadMediaLibrary() {
  const { data, error } = await sb.from('media').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
  if (!error && data) {
    mediaLibrary = data.map(m => ({
      id: m.id, url: m.url,
      thumbnailUrl: m.thumbnail_url || m.url,
      fileType: m.file_type, fileName: m.file_name
    }));
  }
  renderMediaTab();
  renderSchedLibrary();
}

function renderMediaTab() {
  const grid = document.getElementById('media-grid');
  const empty = document.getElementById('media-empty');
  if (!grid) return;
  if (mediaLibrary.length === 0) {
    grid.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';
  grid.innerHTML = mediaLibrary.map(m => `
    <div class="media-thumb">
      <img src="${m.thumbnailUrl}" loading="lazy">
      ${m.fileType === 'video' ? '<div class="media-type-badge">▶ Video</div>' : ''}
      <button class="media-del" onclick="deleteMediaItem('${m.id}')">✕</button>
    </div>
  `).join('');
}

function renderSchedLibrary() {
  const grid = document.getElementById('sched-library-grid');
  const empty = document.getElementById('sched-library-empty');
  if (!grid) return;
  if (mediaLibrary.length === 0) {
    grid.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';
  grid.innerHTML = mediaLibrary.map(m => `
    <div style="position:relative;aspect-ratio:1;border-radius:8px;overflow:hidden;background:var(--card2);cursor:pointer;border:2px solid transparent;transition:border-color 0.2s"
         id="lib-item-${m.id}" onclick="toggleLibrarySelect('${m.id}', '${m.url}', '${m.thumbnailUrl}', '${m.fileType}')">
      <img src="${m.thumbnailUrl}" style="width:100%;height:100%;object-fit:cover" loading="lazy">
      ${m.fileType === 'video' ? '<div style="position:absolute;bottom:4px;left:4px;background:rgba(0,0,0,0.65);border-radius:4px;font-size:10px;padding:2px 5px;color:#fff">▶</div>' : ''}
      <div id="lib-check-${m.id}" style="display:none;position:absolute;inset:0;background:rgba(124,63,204,0.25);align-items:center;justify-content:center;font-size:24px">✓</div>
    </div>
  `).join('');
}

function toggleLibrarySelect(id, url, thumbnailUrl, fileType) {
  const existing = photos.findIndex(p => p.libraryId === id);
  const item = document.getElementById('lib-item-' + id);
  const check = document.getElementById('lib-check-' + id);
  if (existing >= 0) {
    photos.splice(existing, 1);
    if (item) item.style.borderColor = 'transparent';
    if (check) check.style.display = 'none';
  } else {
    photos.push({ url, thumbnailUrl, fileType, libraryId: id, file: null, uploadedUrl: url, caption: '', hashtags: '' });
    if (item) item.style.borderColor = 'var(--gold)';
    if (check) check.style.display = 'flex';
  }
  const next = document.getElementById('step0-next');
  const grid = document.getElementById('photo-grid');
  if (photos.length > 0) {
    if (next) next.style.display = 'block';
    renderPhotoGrid();
    if (grid) grid.style.display = 'grid';
  } else {
    if (next) next.style.display = 'none';
    if (grid) grid.style.display = 'none';
  }
}

async function addToMediaLibrary(files) {
  if (!user) { toast('Please sign in first', 'error'); return; }
  const loading = document.getElementById('media-loading');
  if (loading) loading.style.display = 'block';

  let added = 0;
  for (const file of files) {
    const isVideo = file.type.startsWith('video/');
    const ext = file.name.split('.').pop();
    const path = user.id + '/' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.' + ext;

    try {
      const timeout = new Promise((_, r) => setTimeout(() => r(new Error('Upload timed out')), 30000));
      const upload = sb.storage.from('post-images').upload(path, file, { upsert: false });
      const { data: upData, error: upErr } = await Promise.race([upload, timeout]);
      if (upErr) { toast('Upload failed: ' + upErr.message, 'error'); continue; }

      const { data: { publicUrl } } = sb.storage.from('post-images').getPublicUrl(path);
      let thumbnailUrl = publicUrl;

      if (isVideo) {
        thumbnailUrl = await extractVideoFrame(file, path) || publicUrl;
      }

      const { data: row, error: dbErr } = await sb.from('media').insert({
        user_id: user.id, url: publicUrl,
        thumbnail_url: thumbnailUrl,
        file_type: isVideo ? 'video' : 'photo',
        file_name: file.name
      }).select().single();

      if (dbErr) { toast('Save failed: ' + dbErr.message, 'error'); continue; }

      if (row) {
        mediaLibrary.unshift({ id: row.id, url: publicUrl, thumbnailUrl, fileType: row.file_type, fileName: file.name });
        added++;
      }
    } catch (e) { toast('Error: ' + e.message, 'error'); }
  }

  if (loading) loading.style.display = 'none';
  renderMediaTab();
  renderSchedLibrary();
  if (added > 0) toast(added + ' item' + (added > 1 ? 's' : '') + ' added to library', 'success');
}

async function extractVideoFrame(file, storagePath) {
  return new Promise(resolve => {
    const video = document.createElement('video');
    const blobUrl = URL.createObjectURL(file);
    video.src = blobUrl; video.muted = true; video.currentTime = 1;
    video.addEventListener('seeked', async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = Math.round(600 * (video.videoHeight / video.videoWidth)) || 600;
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(blobUrl);
      canvas.toBlob(async blob => {
        const thumbPath = storagePath.replace(/\.[^.]+$/, '_thumb.jpg');
        const { error } = await sb.storage.from('post-images').upload(thumbPath, blob, { contentType: 'image/jpeg', upsert: false });
        if (!error) {
          const { data: { publicUrl } } = sb.storage.from('post-images').getPublicUrl(thumbPath);
          resolve(publicUrl);
        } else resolve(null);
      }, 'image/jpeg', 0.85);
    });
    video.addEventListener('error', () => { URL.revokeObjectURL(blobUrl); resolve(null); });
    video.load();
  });
}

async function deleteMediaItem(id) {
  mediaLibrary = mediaLibrary.filter(m => m.id !== id);
  await sb.from('media').delete().eq('id', id);
  renderMediaTab();
  renderSchedLibrary();
}

// ---- PLATFORM ----
function setPlatform(p) {
  schedCfg.platform = p;
  document.querySelectorAll('.platform-pill').forEach(el => el.classList.toggle('active', el.dataset.platform === p));
}

// ---- RANDOMIZER LIBRARY ----
function loadRandFromLibrary() {
  if (mediaLibrary.length === 0) { toast('No media in library yet - upload from the Media tab first', 'error'); return; }
  randFiles = mediaLibrary.slice(0, 9).map(m => ({ url: m.thumbnailUrl, name: m.fileName, isLibrary: true }));
  const grid = document.getElementById('spin-grid');
  const empty = document.getElementById('spin-empty');
  grid.innerHTML = '';
  grid.style.display = 'grid';
  if (empty) empty.style.display = 'none';
  for (let i = 0; i < 9; i++) {
    const slot = document.createElement('div');
    slot.className = 'spin-slot';
    if (randFiles[i]) {
      const img = document.createElement('img');
      img.src = randFiles[i].url;
      slot.appendChild(img);
    }
    grid.appendChild(slot);
  }
  document.getElementById('rand-btn').disabled = randFiles.length < 2;
  toast('Loaded ' + randFiles.length + ' items from library', 'success');
}

// ---- TABS ----
function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.tab-item').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).style.display = 'block';
  document.getElementById('tab-btn-' + name).classList.add('active');
  if (name === 'home') loadDashboard();
  if (name === 'media') renderMediaTab();
  if (name === 'schedule') { renderSchedLibrary(); loadSchedPostsList(); }
  if (name === 'randomizer') {
    const empty = document.getElementById('spin-empty');
    const grid = document.getElementById('spin-grid');
    if (mediaLibrary.length === 0 && randFiles.length === 0) {
      if (empty) empty.style.display = 'block';
      if (grid) grid.style.display = 'none';
    }
  }
}

// ---- FILE UPLOAD ----
function addFiles(files) {
  for (const f of files) {
    const key = f.name + '-' + f.size + '-' + f.lastModified;
    if (imgCache.has(key)) continue;
    const url = URL.createObjectURL(f);
    imgCache.set(key, url);
    photos.push({ file: f, url, caption: DEFAULT_CAPTIONS[photos.length % DEFAULT_CAPTIONS.length], hashtags: TAGS[photos.length % TAGS.length] });
  }
  renderPhotoGrid();
  // Also add to media library in background
  if (files.length > 0) addToMediaLibrary(Array.from(files)).catch(() => {});
}

function renderPhotoGrid() {
  const grid = document.getElementById('photo-grid');
  if (photos.length === 0) { grid.style.display = 'none'; document.getElementById('step0-next').style.display = 'none'; return; }
  grid.style.display = 'grid';
  grid.innerHTML = photos.map((p, i) => `
    <div class="photo-item">
      <img src="${p.url}" loading="lazy">
      <button class="photo-remove" onclick="removePhoto(${i})">✕</button>
      <div class="photo-ai-badge">AI</div>
    </div>`).join('');
  document.getElementById('step0-next').style.display = 'block';
}

function removePhoto(i) {
  photos.splice(i, 1);
  renderPhotoGrid();
}

// Drag & drop
const dz = document.getElementById('dropzone');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-over'); addFiles(e.dataTransfer.files); });

// ---- STEPS ----
let currentStep = 0;

function goStep(n) {
  document.getElementById('sched-step-' + currentStep).style.display = 'none';
  document.getElementById('sched-step-' + n).style.display = 'block';

  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById('dot-' + i);
    dot.classList.remove('active', 'done');
    if (i < n) dot.classList.add('done');
    else if (i === n) dot.classList.add('active');
  }

  currentStep = n;
  if (n === 1) renderCaptionList();
  document.querySelector('.app-content').scrollTop = 0;
}

// ---- AI CAPTIONS ----
function renderCaptionList() {
  document.getElementById('caption-list').innerHTML = photos.map((p, i) => `
    <div class="caption-card">
      <div class="caption-card-head">
        <img class="caption-thumb" src="${p.url}" loading="lazy">
        <div>
          <div class="caption-num">Photo ${i + 1} of ${photos.length}</div>
        </div>
      </div>
      <textarea class="caption-input" id="cap-${i}" rows="3" oninput="photos[${i}].caption=this.value">${p.caption}</textarea>
      <div style="margin-top:6px">${p.hashtags.split(' ').map(h => `<span class="hashtag-pill">${h}</span>`).join('')}</div>
    </div>`).join('');
}

function setAIProvider(provider) {
  localStorage.setItem('pf_ai_provider', provider);
  document.querySelectorAll('.ai-pill').forEach(p => p.classList.toggle('active', p.dataset.provider === provider));
  const configs = {
    claude:  { label: 'Claude API Key (optional)',  placeholder: 'sk-ant-... for AI generation',  profilePlaceholder: 'sk-ant-... (optional)',  link: 'https://console.anthropic.com/settings/keys' },
    chatgpt: { label: 'OpenAI API Key (optional)',  placeholder: 'sk-... for AI generation',      profilePlaceholder: 'sk-... (optional)',      link: 'https://platform.openai.com/api-keys' },
    gemini:  { label: 'Gemini API Key (optional)',  placeholder: 'AIza... for AI generation',     profilePlaceholder: 'AIza... (optional)',     link: 'https://aistudio.google.com/app/apikey' }
  };
  const cfg = configs[provider];
  document.querySelectorAll('.ai-key-label').forEach(el => el.textContent = cfg.label);
  document.querySelectorAll('.ai-key-link').forEach(el => el.href = cfg.link);
  const keyInput = document.getElementById('api-key-input');
  const profileInput = document.getElementById('profile-api-key');
  if (keyInput) keyInput.placeholder = cfg.placeholder;
  if (profileInput) profileInput.placeholder = cfg.profilePlaceholder;
  // Restore saved key for this provider
  const saved = localStorage.getItem('pf_api_key_' + provider) || '';
  if (keyInput) keyInput.value = saved;
  if (profileInput) profileInput.value = saved;
}

async function runAI() {
  const provider = localStorage.getItem('pf_ai_provider') || 'claude';
  const key = localStorage.getItem('pf_api_key_' + provider) || localStorage.getItem('pf_api_key') || '';
  if (!key) { toast('Add your API key in Profile > AI Settings first', 'error'); switchTab('profile'); return; }

  const btn = document.getElementById('ai-gen-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';

  const prompt = 'Analyze this luxury beauty product photo and return EXACTLY this format with no other text:\nCAPTION: [2-3 sentence caption, aspirational and luxurious tone, end with "Link in bio", 1-2 relevant emojis, no dashes, written as a premium beauty brand speaking to confident women]\nHASHTAGS: [exactly 5 hashtags: always start with #MessinaGlam, then pick 4 from these top trending 2026 Instagram luxury beauty aesthetics that best match this photo: #GlazedDonutSkin #GlassSkin #SoftGlam #LatteMakeup #CleanGirlAesthetic #BronzedGlow #GlowySkin #LuxuryBeauty]';

  const tasks = photos.map(async (p, i) => {
    try {
      const b64 = await fileToB64(p.file);
      const mediaType = p.file.type || 'image/jpeg';
      let txt = '';

      if (provider === 'claude') {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-calls': 'true'
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 400,
            messages: [{ role: 'user', content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
              { type: 'text', text: prompt }
            ]}]
          })
        });
        if (res.ok) { const d = await res.json(); txt = d.content[0].text.trim(); }

      } else if (provider === 'chatgpt') {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
          body: JSON.stringify({
            model: 'gpt-4o',
            max_tokens: 400,
            messages: [{ role: 'user', content: [
              { type: 'image_url', image_url: { url: 'data:' + mediaType + ';base64,' + b64 } },
              { type: 'text', text: prompt }
            ]}]
          })
        });
        if (res.ok) { const d = await res.json(); txt = d.choices[0].message.content.trim(); }

      } else if (provider === 'gemini') {
        const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + key, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [
              { inline_data: { mime_type: mediaType, data: b64 } },
              { text: prompt }
            ]}],
            generationConfig: { maxOutputTokens: 400 }
          })
        });
        if (res.ok) { const d = await res.json(); txt = d.candidates[0].content.parts[0].text.trim(); }
      }

      if (txt) {
        const capMatch = txt.match(/CAPTION:\s*(.+?)(?:\n|HASHTAGS:)/s);
        const htMatch  = txt.match(/HASHTAGS:\s*(.+)/s);
        if (capMatch) photos[i].caption  = capMatch[1].trim();
        if (htMatch)  photos[i].hashtags = htMatch[1].trim();
      }
    } catch (_) {}
  });

  await Promise.all(tasks);
  btn.disabled = false; btn.textContent = 'Generate';
  renderCaptionList();
  toast('AI captions generated', 'success');
}

function fileToB64(file) {
  return new Promise(resolve => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.readAsDataURL(file);
  });
}

// ---- SCHEDULE CONFIG ----
function populateTZ() {
  const sel = document.getElementById('tz-select');
  const common = [
    'America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
    'America/Phoenix','America/Anchorage','Pacific/Honolulu',
    'Europe/London','Europe/Paris','Europe/Berlin','Europe/Rome',
    'Asia/Tokyo','Asia/Seoul','Asia/Shanghai','Asia/Dubai',
    'Australia/Sydney','Pacific/Auckland'
  ];
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const list = common.includes(local) ? common : [local, ...common];
  sel.innerHTML = list.map(tz => `<option value="${tz}" ${tz === local ? 'selected' : ''}>${tz.replace(/_/g, ' ')}</option>`).join('');
}

function toggleDay(el) {
  el.classList.toggle('active');
  schedCfg.days = [...document.querySelectorAll('.day-chip.active')].map(c => +c.dataset.day);
}

function updateWeeks(v) {
  schedCfg.weeks = +v;
  document.getElementById('weeks-val').textContent = v + ' weeks';
}

// ---- PREVIEW ----
function buildPreview() {
  schedCfg.time    = document.getElementById('post-time').value;
  schedCfg.tz      = document.getElementById('tz-select').value;
  schedCfg.recycle = document.getElementById('recycle-toggle').checked;

  if (schedCfg.days.length === 0) { toast('Select at least one posting day', 'error'); return; }

  const [h, m] = schedCfg.time.split(':').map(Number);
  const slots = [];
  const cursor = new Date();
  cursor.setDate(cursor.getDate() + 1);

  const endDate = new Date();
  endDate.setDate(endDate.getDate() + schedCfg.weeks * 7);

  let idx = 0;
  while (cursor <= endDate) {
    const dayInTZ = getDayInTZ(cursor, schedCfg.tz);
    if (schedCfg.days.includes(dayInTZ)) {
      const utc = zonedToUTC(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate(), h, m, schedCfg.tz);
      const photoIdx = schedCfg.recycle ? idx % photos.length : idx;
      if (!schedCfg.recycle && photoIdx >= photos.length) break;
      slots.push({ utc, photo: photos[photoIdx], idx });
      idx++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  previewSlots = slots;

  const total = slots.length;
  document.getElementById('preview-strip').innerHTML =
    `<strong>${total} post${total !== 1 ? 's' : ''}</strong> will be scheduled over <strong>${schedCfg.weeks} weeks</strong>${schedCfg.recycle ? ' (recycling content)' : ''}.`;

  document.getElementById('preview-list').innerHTML = slots.slice(0, 8).map(s => {
    const d = s.utc;
    const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: schedCfg.tz });
    return `<div class="preview-item">
      <img src="${s.photo.url}" loading="lazy">
      <div>
        <div class="preview-date">${date}</div>
        <div class="preview-time">${time} ${schedCfg.tz.split('/').pop().replace(/_/g, ' ')}</div>
      </div>
    </div>`;
  }).join('') + (slots.length > 8 ? `<div style="font-size:12px;color:var(--gray);padding:8px 0">...and ${slots.length - 8} more</div>` : '');

  goStep(3);
}

function getDayInTZ(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
  const day = fmt.format(date);
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(day);
}

function zonedToUTC(year, month, day, hours, mins, tz) {
  const asUTC = new Date(Date.UTC(year, month - 1, day, hours, mins, 0));
  const fmt   = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
  });
  const p = {};
  fmt.formatToParts(asUTC).forEach(x => { if (x.type !== 'literal') p[x.type] = x.value; });
  let hr = parseInt(p.hour);
  if (hr === 24) hr = 0;
  const tzRep = new Date(Date.UTC(+p.year, +p.month - 1, +p.day, hr, +p.minute, +p.second));
  return new Date(asUTC.getTime() + (asUTC - tzRep));
}

// ---- SCHEDULE ALL ----
async function scheduleAll() {
  const btn = document.getElementById('confirm-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Scheduling...';

  // Upload images in parallel with 10s timeout per image
  const uploadOne = async (p) => {
    if (!p.url.startsWith('blob:') || p.uploadedUrl) return;
    try {
      const ext  = p.file.name.split('.').pop();
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000));
      const upload  = sb.storage.from('post-images').upload(path, p.file, { upsert: false });
      const { data, error } = await Promise.race([upload, timeout]);
      if (!error) {
        const { data: { publicUrl } } = sb.storage.from('post-images').getPublicUrl(path);
        p.uploadedUrl = publicUrl;
      }
    } catch (_) {}
  };
  await Promise.all(photos.map(uploadOne));

  // Insert rows
  const rows = previewSlots.map(s => ({
    image_url:    s.photo.uploadedUrl || s.photo.url,
    content:      (s.photo.caption || '') + '\n\n' + (s.photo.hashtags || ''),
    status:       'scheduled',
    platform:     schedCfg.platform || 'instagram',
    scheduled_at: s.utc.toISOString()
  }));

  const { error } = await sb.from('posts').insert(rows);

  btn.disabled = false; btn.textContent = 'Schedule All Posts';

  if (error) { toast('Error: ' + error.message, 'error'); return; }

  toast(rows.length + ' posts scheduled!', 'success');

  // Reset
  photos = [];
  imgCache.clear();
  previewSlots = [];
  currentStep = 0;
  renderPhotoGrid();
  document.getElementById('photo-grid').style.display = 'none';
  document.getElementById('step0-next').style.display = 'none';
  for (let i = 0; i < 4; i++) {
    const d = document.getElementById('dot-' + i);
    d.classList.remove('active', 'done');
    if (i === 0) d.classList.add('active');
  }
  document.getElementById('sched-step-3').style.display = 'none';
  document.getElementById('sched-step-0').style.display = 'block';

  switchTab('home');
}

// ---- RANDOMIZER ----
let randFiles = [];

function loadRandomizerPhotos(files) {
  randFiles = Array.from(files).slice(0, 9);
  const grid = document.getElementById('spin-grid');
  const empty = document.getElementById('spin-empty');
  grid.innerHTML = '';
  grid.style.display = 'grid';
  if (empty) empty.style.display = 'none';
  for (let i = 0; i < 9; i++) {
    const slot = document.createElement('div');
    slot.className = 'spin-slot';
    if (randFiles[i]) {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(randFiles[i]);
      slot.appendChild(img);
    }
    grid.appendChild(slot);
  }
  document.getElementById('rand-btn').disabled = randFiles.length < 2;
}

function runRandomizer() {
  if (randFiles.length < 2) return;

  const slots = document.querySelectorAll('#spin-grid .spin-slot');
  slots.forEach(s => s.classList.add('spinning'));

  let ticks = 0;
  const interval = setInterval(() => {
    // Shuffle display
    const shuffled = [...randFiles].sort(() => Math.random() - 0.5);
    slots.forEach((slot, i) => {
      if (shuffled[i]) {
        slot.innerHTML = '';
        const img = document.createElement('img');
        img.src = URL.createObjectURL(shuffled[i]);
        slot.appendChild(img);
      }
    });
    ticks++;
    if (ticks >= 12) {
      clearInterval(interval);
      slots.forEach(s => s.classList.remove('spinning'));
      // Final order
      randOrder = [...randFiles].sort(() => Math.random() - 0.5);
      slots.forEach((slot, i) => {
        slot.innerHTML = '';
        if (randOrder[i]) {
          const img = document.createElement('img');
          img.src = URL.createObjectURL(randOrder[i]);
          slot.appendChild(img);
        }
      });
      showRandResult();
    }
  }, 120);
}

function showRandResult() {
  const el = document.getElementById('rand-result');
  el.style.display = 'block';
  document.getElementById('rand-result-grid').innerHTML = randOrder.map(f =>
    `<div class="photo-item"><img src="${URL.createObjectURL(f)}" loading="lazy"></div>`
  ).join('');
}

function sendRandToScheduler() {
  photos = randOrder.map((f, i) => ({
    file: f,
    url: URL.createObjectURL(f),
    caption: DEFAULT_CAPTIONS[i % DEFAULT_CAPTIONS.length],
    hashtags: TAGS[i % TAGS.length]
  }));
  renderPhotoGrid();
  switchTab('schedule');
  toast('Photos loaded in Schedule tab', 'success');
}

// ---- GOOGLE LOGIN ----
async function doGoogleLogin() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: 'https://getpostaway.com' }
  });
  if (error) toast(error.message, 'error');
}

async function doAppleLogin() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo: 'https://getpostaway.com' }
  });
  if (error) toast(error.message, 'error');
}

// ---- SOCIAL CONNECT ----
function connectInstagram() {
  if (!user) { toast('Please sign in first', 'error'); return; }
  const META_APP_ID = '27694391816864880';
  const CALLBACK_URI = encodeURIComponent('https://aajkbqmzuqfzzugjmerp.supabase.co/functions/v1/instagram-oauth-callback');
  const SCOPES = 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement';
  const url = `https://www.facebook.com/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${CALLBACK_URI}&scope=${SCOPES}&state=${user.id}`;
  window.location.href = url;
}
function connectTikTok() {
  if (!user) { toast('Please sign in first', 'error'); return; }
  const CLIENT_KEY = 'awhyljrxgkpuyg5r';
  const CALLBACK_URI = encodeURIComponent('https://aajkbqmzuqfzzugjmerp.supabase.co/functions/v1/tiktok-oauth-callback');
  const SCOPES = encodeURIComponent('user.info.basic,video.publish,video.upload');
  const url = `https://www.tiktok.com/v2/auth/authorize?client_key=${CLIENT_KEY}&redirect_uri=${CALLBACK_URI}&scope=${SCOPES}&response_type=code&state=${user.id}`;
  window.location.href = url;
}

// ---- HANDLE OAUTH RETURN ----
function handleOAuthReturn() {
  const params = new URLSearchParams(window.location.search);
  const igConnected = params.get('ig_connected');
  const igUser = params.get('ig_user');
  const igError = params.get('ig_error');
  const ttConnected = params.get('tt_connected');
  const ttUser = params.get('tt_user');
  const ttError = params.get('tt_error');

  if (igConnected === 'true') {
    cookieStorage.setItem('ig_connected', 'true');
    cookieStorage.setItem('ig_username', igUser || 'connected');
    localStorage.setItem('ig_connected', 'true');
    localStorage.setItem('ig_username', igUser || 'connected');
    window.history.replaceState({}, '', window.location.pathname);
    toast('Instagram connected' + (igUser && igUser !== 'connected' ? ' as @' + igUser : '') + '!', 'success');
  }
  if (igError) {
    window.history.replaceState({}, '', window.location.pathname);
    toast('Instagram connection failed: ' + igError, 'error');
  }
  if (ttConnected === 'true') {
    cookieStorage.setItem('tt_connected', 'true');
    cookieStorage.setItem('tt_username', ttUser || 'connected');
    localStorage.setItem('tt_connected', 'true');
    localStorage.setItem('tt_username', ttUser || 'connected');
    window.history.replaceState({}, '', window.location.pathname);
    toast('TikTok connected' + (ttUser && ttUser !== 'connected' ? ' as @' + ttUser : '') + '!', 'success');
  }
  if (ttError) {
    window.history.replaceState({}, '', window.location.pathname);
    toast('TikTok connection failed: ' + ttError, 'error');
  }
}

// ---- RENDER CONNECTED ACCOUNTS ----
function renderConnectedAccounts() {
  const igConnected = cookieStorage.getItem('ig_connected') === 'true' || localStorage.getItem('ig_connected') === 'true';
  const igUsername = cookieStorage.getItem('ig_username') || localStorage.getItem('ig_username');
  const ttConnected = cookieStorage.getItem('tt_connected') === 'true' || localStorage.getItem('tt_connected') === 'true';
  const ttUsername = cookieStorage.getItem('tt_username') || localStorage.getItem('tt_username');

  const igStatusEl = document.getElementById('ig-status-label');
  const igBtnEl = document.getElementById('ig-connect-btn');
  const ttStatusEl = document.getElementById('tt-status-label');
  const ttBtnEl = document.getElementById('tt-connect-btn');
  const banner = document.getElementById('ig-banner');
  const queueNotice = document.getElementById('queue-notice');

  if (igConnected) {
    if (igStatusEl) { igStatusEl.textContent = '@' + (igUsername || 'connected'); igStatusEl.style.color = 'var(--success)'; }
    if (igBtnEl) { igBtnEl.textContent = 'Reconnect'; }
    if (banner) banner.style.display = 'none';
  } else {
    if (banner) banner.style.display = '';
  }

  if (ttConnected) {
    if (ttStatusEl) { ttStatusEl.textContent = '@' + (ttUsername || 'connected'); ttStatusEl.style.color = 'var(--success)'; }
    if (ttBtnEl) { ttBtnEl.textContent = 'Reconnect'; }
  }

  if (queueNotice) {
    if (igConnected && ttConnected) {
      queueNotice.innerHTML = '<strong style="color:var(--success)">Instagram + TikTok connected.</strong> Posts will be published automatically at your scheduled times.';
    } else if (igConnected) {
      queueNotice.innerHTML = '<strong style="color:var(--success)">Instagram connected.</strong> Posts will be published automatically at your scheduled times.';
    } else if (ttConnected) {
      queueNotice.innerHTML = '<strong style="color:var(--success)">TikTok connected.</strong> Posts will be published automatically at your scheduled times.';
    }
  }
}

// ---- API KEY ----
function saveApiKey() {
  const provider = localStorage.getItem('pf_ai_provider') || 'claude';
  const key = document.getElementById('profile-api-key').value.trim();
  localStorage.setItem('pf_api_key_' + provider, key);
  localStorage.setItem('pf_api_key', key);
  document.getElementById('api-key-input').value = key;
  toast('API key saved', 'success');
}

// ---- SESSION RESTORE ----
async function init() {
  const { data } = await sb.auth.getSession();
  if (data.session) {
    user = data.session.user;
    initApp();
  } else {
    showScreen('screen-landing');
  }

  sb.auth.onAuthStateChange((event, session) => {
    if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session && !user) {
      user = session.user;
      initApp(pendingNewUserOnboard);
    }
    if (event === 'SIGNED_OUT') {
      user = null;
      showScreen('screen-landing');
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();

// ============================================================
// STRIPE SUBSCRIPTION SYSTEM
// ============================================================

const STRIPE_PK = 'pk_live_51S0D0bBDiYRcrvlHMXpuZu5DDy3YKvnt5E8wToeQiqxOUIpZ6RmEPbjObOpjQiTsqrGUCImlF14KrQvrjCZEi7AT001FBJtfTM';
const STRIPE_PRICES = {
  starter_monthly: 'price_1TxGT0BDiYRcrvlHpnE3PBHF',
  starter_annual:  'price_1TxGUjBDiYRcrvlHRQNDfZZN',
  pro_monthly:     'price_1TxGVZBDiYRcrvlHpUEIgEfR',
  pro_annual:      'price_1TxGWSBDiYRcrvlHZKj1VloK',
};

// Plan limits
const PLAN_LIMITS = {
  free:    { posts: 10, drafts: 10, platforms: 0, analytics: false },
  starter: { posts: Infinity, drafts: Infinity, platforms: 1, analytics: true },
  pro:     { posts: Infinity, drafts: Infinity, platforms: 2, analytics: true },
};

let _currentPlan = 'free';
let _planLoaded = false;

// Load plan from Supabase
async function loadUserPlan() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { _currentPlan = 'free'; _planLoaded = true; return 'free'; }

    const { data, error } = await sb
      .from('subscriptions')
      .select('plan, status, current_period_end')
      .eq('user_id', session.user.id)
      .single();

    if (error || !data) { _currentPlan = 'free'; _planLoaded = true; return 'free'; }

    const isActive = data.status === 'active' || data.status === 'trialing';
    const notExpired = !data.current_period_end || new Date(data.current_period_end * 1000) > new Date();
    _currentPlan = (isActive && notExpired) ? (data.plan || 'free') : 'free';
    _planLoaded = true;
    return _currentPlan;
  } catch(e) {
    _currentPlan = 'free';
    _planLoaded = true;
    return 'free';
  }
}

function getCurrentPlan() { return _currentPlan; }
function getPlanLimits() { return PLAN_LIMITS[_currentPlan] || PLAN_LIMITS.free; }

// Gate check - returns true if action is allowed
function canDoAction(action, currentCount) {
  const limits = getPlanLimits();
  if (action === 'schedule_post') return currentCount < limits.posts;
  if (action === 'save_draft') return currentCount < limits.drafts;
  if (action === 'connect_platform') return currentCount < limits.platforms;
  if (action === 'view_analytics') return limits.analytics;
  return true;
}

// Show upgrade prompt
function showUpgradePrompt(reason) {
  const messages = {
    schedule_post: 'You have reached your 10 post/month limit on the Free plan.',
    save_draft: 'You have reached your 10 draft limit on the Free plan.',
    connect_platform: _currentPlan === 'starter'
      ? 'Pro plan lets you connect both Instagram and TikTok.'
      : 'Upgrade to connect social platforms.',
    view_analytics: 'Analytics are available on Starter and Pro plans.',
  };
  const msg = messages[reason] || 'Upgrade your plan to unlock this feature.';
  showPricingModal(msg);
}

// ============================================================
// PRICING MODAL
// ============================================================

let _pricingBillingAnnual = false;

function showPricingModal(headerMsg) {
  if (document.getElementById('pricing-modal')) return;

  const overlay = document.createElement('div');
  overlay.id = 'pricing-modal';
  overlay.innerHTML = `
    <div class="pm-backdrop" onclick="closePricingModal()"></div>
    <div class="pm-sheet">
      <button class="pm-close" onclick="closePricingModal()">&#x2715;</button>
      ${headerMsg ? `<div class="pm-alert">${headerMsg}</div>` : ''}
      <h2 class="pm-title">Choose your plan</h2>

      <div class="pm-billing-toggle">
        <span class="pm-toggle-label" id="pm-monthly-label" style="font-weight:700">Monthly</span>
        <label class="pm-switch">
          <input type="checkbox" id="pm-annual-toggle" onchange="toggleBilling(this.checked)">
          <span class="pm-slider"></span>
        </label>
        <span class="pm-toggle-label" id="pm-annual-label">Annual <span class="pm-save-badge">Save 33%</span></span>
      </div>

      <div class="pm-cards">

        <!-- FREE -->
        <div class="pm-card ${_currentPlan === 'free' ? 'pm-current' : ''}">
          <div class="pm-card-header">
            <div class="pm-plan-name">Free</div>
            <div class="pm-price-wrap"><span class="pm-price">$0</span><span class="pm-per">/mo</span></div>
          </div>
          <ul class="pm-features">
            <li>10 scheduled posts/month</li>
            <li>10 drafts</li>
            <li>1 platform (Instagram or TikTok)</li>
          </ul>
          ${_currentPlan === 'free' ? '<div class="pm-current-badge">Current plan</div>' : ''}
        </div>

        <!-- STARTER -->
        <div class="pm-card pm-popular ${_currentPlan === 'starter' ? 'pm-current' : ''}">
          <div class="pm-popular-badge">Most popular</div>
          <div class="pm-card-header">
            <div class="pm-plan-name">Starter</div>
            <div class="pm-price-wrap">
              <span class="pm-price" id="pm-starter-price">$12</span>
              <span class="pm-per">/mo</span>
            </div>
            <div class="pm-billed-note" id="pm-starter-note"></div>
          </div>
          <ul class="pm-features">
            <li>Unlimited posts</li>
            <li>Unlimited drafts</li>
            <li>1 platform (Instagram or TikTok)</li>
            <li>Analytics</li>
            <li>5-day free trial</li>
          </ul>
          ${_currentPlan === 'starter'
            ? '<div class="pm-current-badge">Current plan</div>'
            : `<button class="pm-cta" onclick="startCheckout('starter')">Start free trial</button>`}
        </div>

        <!-- PRO -->
        <div class="pm-card ${_currentPlan === 'pro' ? 'pm-current' : ''}">
          <div class="pm-card-header">
            <div class="pm-plan-name">Pro</div>
            <div class="pm-price-wrap">
              <span class="pm-price" id="pm-pro-price">$24</span>
              <span class="pm-per">/mo</span>
            </div>
            <div class="pm-billed-note" id="pm-pro-note"></div>
          </div>
          <ul class="pm-features">
            <li>Unlimited posts</li>
            <li>Unlimited drafts</li>
            <li>Both Instagram + TikTok</li>
            <li>Analytics</li>
            <li>5-day free trial</li>
            <li>Priority support</li>
          </ul>
          ${_currentPlan === 'pro'
            ? '<div class="pm-current-badge">Current plan</div>'
            : `<button class="pm-cta pm-cta-pro" onclick="startCheckout('pro')">Start free trial</button>`}
        </div>

      </div>
      <p class="pm-footer">Cancel anytime. No hidden fees.</p>
    </div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.querySelector('.pm-sheet').classList.add('pm-sheet-in'));
}

function closePricingModal() {
  const m = document.getElementById('pricing-modal');
  if (m) { m.querySelector('.pm-sheet').classList.remove('pm-sheet-in'); setTimeout(() => m.remove(), 300); }
}

function toggleBilling(annual) {
  _pricingBillingAnnual = annual;
  const monthlyLabel = document.getElementById('pm-monthly-label');
  const annualLabel = document.getElementById('pm-annual-label');
  if (monthlyLabel) monthlyLabel.style.fontWeight = annual ? '400' : '700';
  if (annualLabel) annualLabel.style.fontWeight = annual ? '700' : '400';

  const starterPrice = document.getElementById('pm-starter-price');
  const starterNote = document.getElementById('pm-starter-note');
  const proPrice = document.getElementById('pm-pro-price');
  const proNote = document.getElementById('pm-pro-note');

  if (starterPrice) starterPrice.textContent = annual ? '$8' : '$12';
  if (starterNote) starterNote.textContent = annual ? 'Billed $96/year' : '';
  if (proPrice) proPrice.textContent = annual ? '$16' : '$24';
  if (proNote) proNote.textContent = annual ? 'Billed $192/year' : '';
}

async function startCheckout(plan) {
  const btn = event.target;
  btn.textContent = 'Loading...';
  btn.disabled = true;

  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      alert('Please sign in first to subscribe.');
      btn.textContent = 'Start free trial';
      btn.disabled = false;
      return;
    }

    const priceKey = `${plan}_${_pricingBillingAnnual ? 'annual' : 'monthly'}`;
    const priceId = STRIPE_PRICES[priceKey];

    const { data, error } = await sb.functions.invoke('stripe-checkout', {
      body: { price_id: priceId, user_id: session.user.id, email: session.user.email },
    });

    if (error || !data?.url) throw new Error(error?.message || 'Could not create checkout session');
    window.location.href = data.url;
  } catch(e) {
    console.error('Checkout error:', e);
    alert('Something went wrong. Please try again.');
    btn.textContent = 'Start free trial';
    btn.disabled = false;
  }
}

// ============================================================
// PRICING CSS (injected once)
// ============================================================
(function injectPricingStyles() {
  if (document.getElementById('pricing-styles')) return;
  const s = document.createElement('style');
  s.id = 'pricing-styles';
  s.textContent = `
    #pricing-modal { position:fixed; inset:0; z-index:9999; display:flex; align-items:flex-end; justify-content:center; }
    .pm-backdrop { position:absolute; inset:0; background:rgba(0,0,0,0.55); }
    .pm-sheet { position:relative; background:#fff; border-radius:20px 20px 0 0; width:100%; max-width:520px; max-height:92vh; overflow-y:auto; padding:24px 20px 40px; transform:translateY(100%); transition:transform .3s cubic-bezier(.4,0,.2,1); }
    .pm-sheet-in { transform:translateY(0); }
    .pm-close { position:absolute; top:16px; right:16px; background:none; border:none; font-size:20px; cursor:pointer; color:#666; }
    .pm-alert { background:#fff3e0; border-left:3px solid #ff9800; padding:10px 14px; border-radius:6px; font-size:13px; color:#e65100; margin-bottom:16px; }
    .pm-title { font-size:22px; font-weight:700; color:#1a1a1a; margin:0 0 16px; text-align:center; }
    .pm-billing-toggle { display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:20px; }
    .pm-toggle-label { font-size:14px; color:#333; }
    .pm-save-badge { background:#7c3fcc; color:#fff; font-size:10px; padding:2px 6px; border-radius:10px; margin-left:4px; }
    .pm-switch { position:relative; width:40px; height:22px; }
    .pm-switch input { opacity:0; width:0; height:0; }
    .pm-slider { position:absolute; inset:0; background:#ddd; border-radius:22px; cursor:pointer; transition:.3s; }
    .pm-slider:before { content:''; position:absolute; width:16px; height:16px; left:3px; bottom:3px; background:#fff; border-radius:50%; transition:.3s; }
    .pm-switch input:checked + .pm-slider { background:#7c3fcc; }
    .pm-switch input:checked + .pm-slider:before { transform:translateX(18px); }
    .pm-cards { display:flex; flex-direction:column; gap:14px; }
    .pm-card { border:1.5px solid #e0e0e0; border-radius:14px; padding:18px 16px 16px; position:relative; }
    .pm-popular { border-color:#7c3fcc; }
    .pm-current { border-color:#4caf50; }
    .pm-popular-badge { position:absolute; top:-10px; left:16px; background:#7c3fcc; color:#fff; font-size:11px; font-weight:600; padding:2px 10px; border-radius:10px; }
    .pm-card-header { margin-bottom:10px; }
    .pm-plan-name { font-size:15px; font-weight:700; color:#1a1a1a; margin-bottom:4px; }
    .pm-price-wrap { display:flex; align-items:baseline; gap:2px; }
    .pm-price { font-size:30px; font-weight:800; color:#1a1a1a; }
    .pm-per { font-size:13px; color:#888; }
    .pm-billed-note { font-size:11px; color:#888; margin-top:2px; }
    .pm-features { list-style:none; padding:0; margin:0 0 12px; }
    .pm-features li { font-size:13px; color:#444; padding:3px 0 3px 18px; position:relative; }
    .pm-features li:before { content:'\\2713'; position:absolute; left:0; color:#7c3fcc; font-weight:700; }
    .pm-cta { display:block; width:100%; background:#7c3fcc; color:#fff; border:none; padding:13px; border-radius:10px; font-size:15px; font-weight:600; cursor:pointer; }
    .pm-cta-pro { background:#1a1a1a; }
    .pm-cta:disabled { opacity:0.6; }
    .pm-current-badge { text-align:center; font-size:13px; color:#4caf50; font-weight:600; padding:8px 0 0; }
    .pm-footer { text-align:center; font-size:12px; color:#aaa; margin:16px 0 0; }
  `;
  document.head.appendChild(s);
})();

// ============================================================
// INIT - load plan on app start, then enforce gates
// ============================================================
(function initStripe() {
  // Load plan when app starts
  loadUserPlan().then(plan => {
    console.log('[PostAway] Plan loaded:', plan);
  });

  // Patch switchTab to show upgrade for analytics on free plan
  const _origSwitchTabStripe = window.switchTab;
  window.switchTab = function(tab) {
    if (tab === 'analytics' && _currentPlan === 'free') {
      showUpgradePrompt('view_analytics');
      return;
    }
    if (typeof _origSwitchTabStripe === 'function') _origSwitchTabStripe(tab);
  };
})();
