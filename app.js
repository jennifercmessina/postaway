// ============================================================
// CONFIG - UPDATE THESE WITH YOUR SUPABASE PROJECT DETAILS
// ============================================================
const SB_URL = 'https://aajkbqmzuqfzzugjmerp.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhamticW16dXFmenp1Z2ptZXJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzOTYwNTgsImV4cCI6MjA5ODk3MjA1OH0.x9c12iuhC2DNXyHGSixFK1j58wMrN7ZJbrSgG2dsrGA';
// ============================================================

// Cookie storage so OAuth sessions work in iOS standalone PWA mode
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

// ---- PLAN LIMITS ----
const PLAN_LIMITS = {
  free:    { maxPosts: 10,       label: 'Free Plan', canUseTikTok: false, canUseBoth: false, canUseAI: false },
  starter: { maxPosts: Infinity, label: 'Starter',   canUseTikTok: true,  canUseBoth: false, canUseAI: true  },
  pro:     { maxPosts: Infinity, label: 'Pro',        canUseTikTok: true,  canUseBoth: true,  canUseAI: true  }
};

// App state
let user = null;
let pendingNewUserOnboard = false;
let photos = [];
let schedCfg = { days: [2, 4], time: '09:00', tz: Intl.DateTimeFormat().resolvedOptions().timeZone, weeks: 12, recycle: false, platform: 'instagram' };
let previewSlots = [];
let randPhotos = [];
let randOrder = [];
let imgCache = new Map();
let mediaLibrary = [];
let userPlan = 'free';
let userSubscription = null;

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
  pendingNewUserOnboard = false;
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

  const savedProvider = localStorage.getItem('pf_ai_provider') || 'claude';
  setAIProvider(savedProvider);

  loadMediaLibrary();
  handleOAuthReturn();
  renderConnectedAccounts();
  await loadDashboard();
  await loadSubscription();
  checkUpgradePrompts();
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

  // Upgrade CTA banner - only show when free user hits the 10-post limit
  const upgradeBar = document.getElementById('dashboard-upgrade-bar');
  if (upgradeBar) {
    const totalPosts = scheduled.length + published.length;
    upgradeBar.style.display = (userPlan === 'free' && totalPosts >= 10) ? 'block' : 'none';
  }

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
  const limits = PLAN_LIMITS[userPlan] || PLAN_LIMITS.free;
  if (p === 'tiktok' && !limits.canUseTikTok) { showUpgradePrompt('tiktok'); return; }
  if (p === 'both'   && !limits.canUseBoth)   { showUpgradePrompt('both');   return; }
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
  if (name === 'analytics') renderAnalytics();
  if (name === 'profile') loadBrandSettings();
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
    <div class="caption-card" id="caption-card-${i}">
      <div class="caption-card-head">
        <img class="caption-thumb" src="${p.url}" loading="lazy">
        <div>
          <div class="caption-num">Photo ${i + 1} of ${photos.length}</div>
          <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">Type a note or let AI write it for you</div>
        </div>
      </div>
      <textarea class="caption-input" id="cap-${i}" rows="3" placeholder="Type a direction (e.g. &quot;sunset beach vibes&quot;) or leave blank for a fresh take..." oninput="photos[${i}].caption=this.value">${p.caption||''}</textarea>
      <div id="ht-pills-${i}" style="margin-top:6px;min-height:24px;">${(p.hashtags||'').split(' ').filter(Boolean).map(h => `<span class="hashtag-pill">${h}</span>`).join('')}</div>
      <div id="ai-loading-${i}" style="display:none;font-size:0.78rem;color:var(--accent-light);padding:6px 0;">&#10024; Generating...</div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button class="btn" style="flex:1;font-size:0.75rem;padding:7px 10px;background:var(--primary-grad);color:#fff;border:none;" onclick="runAISingle(${i},'refine')">&#10024; Generate from my notes</button>
        <button class="btn" style="flex:1;font-size:0.75rem;padding:7px 10px;background:rgba(255,255,255,0.07);color:var(--text-main);border:1px solid var(--border-subtle);" onclick="runAISingle(${i},'fresh')">&#127922; Surprise me</button>
      </div>
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
  const saved = localStorage.getItem('pf_api_key_' + provider) || '';
  if (keyInput) keyInput.value = saved;
  if (profileInput) profileInput.value = saved;
}

async function callCaptionAI(imageB64, mediaType, userHint, mode, imageUrl = null) {
  const SUPABASE_URL = 'https://aajkbqmzuqfzzugjmerp.supabase.co';
  const hintLine = (mode === 'refine' && userHint && userHint.trim())
    ? `\nThe creator has provided this direction: "${userHint.trim()}". Incorporate this tone/theme into the caption.`
    : (mode === 'fresh' ? '\nIgnore any previous caption - write something completely fresh and surprising.' : '');

  const prompt = `Analyze this luxury beauty photo and return EXACTLY this format with no other text:\nCAPTION: [2-3 sentence caption, aspirational and luxurious tone, end with "Link in bio", 1-2 relevant emojis, no em dashes, written as a premium beauty brand speaking to confident women]${hintLine}\nHASHTAGS: [exactly 5 hashtags: always start with #MessinaGlam, then pick 4 from: #GlazedDonutSkin #GlassSkin #SoftGlam #LatteMakeup #CleanGirlAesthetic #BronzedGlow #GlowySkin #LuxuryBeauty]`;

  // Try server-side edge function first (no user API key needed)
  try {
    const { data: { session } } = await sb.auth.getSession();
    const token = session?.access_token;
    if (token) {
      const brand = getBrandContext();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-caption`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ imageB64, imageUrl, mediaType, userHint, mode, ...brand })
      });
      if (res.ok) {
        const d = await res.json();
        return d.text || '';
      }
    }
  } catch (_) {}

  // Fallback to user's own API key if they have one
  const provider = localStorage.getItem('pf_ai_provider') || 'claude';
  const key = localStorage.getItem('pf_api_key_' + provider) || localStorage.getItem('pf_api_key') || '';
  if (!key) return null; // no key available

  if (provider === 'claude') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-calls': 'true' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 400, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: imageB64 } }, { type: 'text', text: prompt }] }] })
    });
    if (res.ok) { const d = await res.json(); return d.content[0].text.trim(); }
  } else if (provider === 'chatgpt') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({ model: 'gpt-4o', max_tokens: 400, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:' + mediaType + ';base64,' + imageB64 } }, { type: 'text', text: prompt }] }] })
    });
    if (res.ok) { const d = await res.json(); return d.choices[0].message.content.trim(); }
  } else if (provider === 'gemini') {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: mediaType, data: imageB64 } }, { text: prompt }] }], generationConfig: { maxOutputTokens: 400 } })
    });
    if (res.ok) { const d = await res.json(); return d.candidates[0].content.parts[0].text.trim(); }
  }
  return null;
}

function parseCaptionAIResponse(txt, index) {
  if (!txt) return;
  const capMatch = txt.match(/CAPTION:\s*(.+?)(?:\n|HASHTAGS:)/s);
  const htMatch  = txt.match(/HASHTAGS:\s*(.+)/s);
  if (capMatch) photos[index].caption  = capMatch[1].trim();
  if (htMatch)  photos[index].hashtags = htMatch[1].trim();
  // Update the DOM in place without full re-render
  const ta = document.getElementById('cap-' + index);
  const pills = document.getElementById('ht-pills-' + index);
  if (ta) ta.value = photos[index].caption || '';
  if (pills) pills.innerHTML = (photos[index].hashtags || '').split(' ').filter(Boolean).map(h => `<span class="hashtag-pill">${h}</span>`).join('');
}

async function runAISingle(index, mode) {
  const limits = PLAN_LIMITS[userPlan] || PLAN_LIMITS.free;
  if (!limits.canUseAI) { showUpgradePrompt('ai'); return; }

  const p = photos[index];
  if (!p) return;

  const loading = document.getElementById('ai-loading-' + index);
  const card = document.getElementById('caption-card-' + index);
  if (loading) loading.style.display = 'block';
  if (card) card.querySelectorAll('button').forEach(b => b.disabled = true);

  try {
    let b64 = null, mediaType = 'image/jpeg';
    const isVideo = (p.file && p.file.type.startsWith('video/')) ||
                    (!p.file && (p.url || p.uploadedUrl || '').match(/\.(mp4|mov|avi|webm|hevc)/i));

    if (!isVideo) {
      // Get an object URL to draw on canvas regardless of source
      let srcUrl = null;
      let ownedUrl = false;
      if (p.file) {
        srcUrl = URL.createObjectURL(p.file);
        ownedUrl = true;
      } else if (p.uploadedUrl || p.url) {
        try {
          const imgRes = await fetch(p.uploadedUrl || p.url);
          if (imgRes.ok) {
            const blob = await imgRes.blob();
            srcUrl = URL.createObjectURL(blob);
            ownedUrl = true;
          }
        } catch (_) {}
        if (!srcUrl) srcUrl = p.uploadedUrl || p.url;
      }

      if (srcUrl) {
        // Draw through canvas: normalizes HEIC, resizes to 1024px max, outputs JPEG
        b64 = await new Promise(resolve => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            const MAX = 1024;
            let w = img.naturalWidth || img.width;
            let h = img.naturalHeight || img.height;
            if (w > MAX || h > MAX) {
              if (w >= h) { h = Math.round(h * MAX / w); w = MAX; }
              else { w = Math.round(w * MAX / h); h = MAX; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            if (ownedUrl) URL.revokeObjectURL(srcUrl);
            resolve(canvas.toDataURL('image/jpeg', 0.88).split(',')[1]);
          };
          img.onerror = () => { if (ownedUrl) URL.revokeObjectURL(srcUrl); resolve(null); };
          img.src = srcUrl;
        });
        mediaType = 'image/jpeg';
      }
    }

    const userHint = document.getElementById('cap-' + index)?.value || '';
    const txt = await callCaptionAI(b64, mediaType, userHint, mode, null);
    if (txt) {
      parseCaptionAIResponse(txt, index);
      toast('Caption generated', 'success');
    } else {
      toast('Could not generate - check AI settings in Profile', 'error');
    }
  } catch (e) {
    toast('Generation failed', 'error');
  }

  if (loading) loading.style.display = 'none';
  if (card) card.querySelectorAll('button').forEach(b => b.disabled = false);
}

async function runAI(mode) {
  const limits = PLAN_LIMITS[userPlan] || PLAN_LIMITS.free;
  if (!limits.canUseAI) { showUpgradePrompt('ai'); return; }

  const btn = document.getElementById('ai-gen-btn');
  const btn2 = document.getElementById('ai-gen-btn-fresh');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Generating...'; }
  if (btn2) btn2.disabled = true;

  const tasks = photos.map((_, i) => runAISingle(i, mode || 'fresh'));
  await Promise.all(tasks);

  if (btn) { btn.disabled = false; btn.innerHTML = '&#10024; Generate from my notes'; }
  if (btn2) { btn2.disabled = false; }
  toast('All captions generated', 'success');
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

  // Free plan post limit check
  if (userPlan === 'free') {
    const { count } = await sb.from('posts').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('status', 'scheduled');
    if (((count || 0) + previewSlots.length) > PLAN_LIMITS.free.maxPosts) {
      btn.disabled = false; btn.textContent = 'Schedule All Posts';
      showUpgradePrompt('posts');
      return;
    }
  }

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

  // First-post upgrade prompt for free users
  if (userPlan === 'free' && !localStorage.getItem('pa_upgrade_shown_firstpost')) {
    localStorage.setItem('pa_upgrade_shown_firstpost', '1');
    setTimeout(() => showUpgradePrompt('firstpost'), 2500);
  }
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

function getFileUrl(f) {
  return f.isLibrary ? f.url : (f._cachedUrl || (f._cachedUrl = URL.createObjectURL(f)));
}

function runRandomizer() {
  if (randFiles.length < 2) return;

  const slots = document.querySelectorAll('#spin-grid .spin-slot');
  slots.forEach(s => s.classList.add('spinning'));

  // Pre-build stable img elements - just swap src, never recreate
  slots.forEach((slot, i) => {
    if (!slot.querySelector('img') && randFiles[i]) {
      const img = document.createElement('img');
      img.src = getFileUrl(randFiles[i]);
      slot.appendChild(img);
    }
  });

  const allUrls = randFiles.map(f => getFileUrl(f));

  let ticks = 0;
  const interval = setInterval(() => {
    const shuffledUrls = [...allUrls].sort(() => Math.random() - 0.5);
    slots.forEach((slot, i) => {
      const img = slot.querySelector('img');
      if (img && shuffledUrls[i]) img.src = shuffledUrls[i];
    });
    ticks++;
    if (ticks >= 12) {
      clearInterval(interval);
      slots.forEach(s => s.classList.remove('spinning'));
      randOrder = [...randFiles].sort(() => Math.random() - 0.5);
      slots.forEach((slot, i) => {
        const img = slot.querySelector('img');
        if (img && randOrder[i]) img.src = getFileUrl(randOrder[i]);
      });
      showRandResult();
    }
  }, 120);
}

function showRandResult() {
  const el = document.getElementById('rand-result');
  el.style.display = 'block';
  document.getElementById('rand-result-grid').innerHTML = randOrder.map(f =>
    `<div class="photo-item"><img src="${getFileUrl(f)}" loading="lazy"></div>`
  ).join('');
}

function sendRandToScheduler() {
  photos = randOrder.map((f, i) => ({
    file: f.isLibrary ? null : f,
    url: getFileUrl(f),
    uploadedUrl: f.isLibrary ? f.url : null,
    caption: DEFAULT_CAPTIONS[i % DEFAULT_CAPTIONS.length],
    hashtags: TAGS[i % TAGS.length]
  }));
  renderPhotoGrid();
  switchTab('schedule');
  toast('Photos loaded in Schedule tab - captions and tags ready', 'success');
}

// ---- GOOGLE / APPLE LOGIN ----
async function doGoogleLogin() {
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: 'https://getpostaway.com' } });
  if (error) toast(error.message, 'error');
}

async function doAppleLogin() {
  const { error } = await sb.auth.signInWithOAuth({ provider: 'apple', options: { redirectTo: 'https://getpostaway.com' } });
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

// ---- BRAND SETTINGS ----
function saveBrandSettings() {
  const name = document.getElementById('brand-name-input')?.value.trim() || '';
  const niche = document.getElementById('brand-niche-input')?.value.trim() || '';
  const voice = document.getElementById('brand-voice-input')?.value.trim() || '';
  localStorage.setItem('pf_brand_name', name);
  localStorage.setItem('pf_brand_niche', niche);
  localStorage.setItem('pf_brand_voice', voice);
  toast('Brand settings saved', 'success');
}

function loadBrandSettings() {
  const nameEl = document.getElementById('brand-name-input');
  const nicheEl = document.getElementById('brand-niche-input');
  const voiceEl = document.getElementById('brand-voice-input');
  if (nameEl) nameEl.value = localStorage.getItem('pf_brand_name') || '';
  if (nicheEl) nicheEl.value = localStorage.getItem('pf_brand_niche') || '';
  if (voiceEl) voiceEl.value = localStorage.getItem('pf_brand_voice') || '';
}

function getBrandContext() {
  return {
    brandName: localStorage.getItem('pf_brand_name') || '',
    brandNiche: localStorage.getItem('pf_brand_niche') || '',
    brandVoice: localStorage.getItem('pf_brand_voice') || ''
  };
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

// ---- SUBSCRIPTION ----
async function loadSubscription() {
  // Developer account - show plan toggle bar, default to pro
  if (user && user.email === 'business@jennifercmessina.com') {
    userPlan = 'pro';
    const bar = document.getElementById('dev-plan-bar');
    if (bar) bar.style.display = 'flex';
    devSetPlan('pro');
    return;
  }

  try {
    const { data } = await sb.from('subscriptions').select('*').eq('user_id', user.id).maybeSingle();
    if (data && data.status !== 'cancelled') {
      userSubscription = data;
      userPlan = data.plan || 'free';
    } else {
      userPlan = 'free';
      userSubscription = null;
    }
  } catch (_) {
    userPlan = 'free';
  }
  updatePlanUI();
}

function updatePlanUI() {
  const limits = PLAN_LIMITS[userPlan] || PLAN_LIMITS.free;
  const label = limits.label || 'Free Plan';
  const badge = document.getElementById('plan-badge');
  const planVal = document.getElementById('profile-plan-val');
  if (badge) badge.textContent = label;
  if (planVal) planVal.textContent = label;
  const upgradeSection = document.getElementById('upgrade-section');
  if (upgradeSection) upgradeSection.style.display = userPlan === 'pro' ? 'none' : 'block';

  // Update AI nudge message based on plan
  const nudge = document.getElementById('ai-nudge-msg');
  if (nudge) {
    if (!limits.canUseAI) {
      nudge.innerHTML = '✦ <strong style="color:var(--gold-light)">AI Captions</strong> are a Starter and Pro feature. <a href="#" onclick="showUpgradePrompt(\'ai\');return false" style="color:var(--gold-light);text-decoration:underline">Upgrade to unlock</a> auto-generated captions and hashtags.';
    } else {
      nudge.innerHTML = '✦ <strong style="color:var(--gold-light)">AI caption generation</strong> - add your API key in <a href="#" onclick="switchTab(\'profile\');return false">Profile &gt; AI Settings</a> to auto-generate captions and hashtags for your posts.';
    }
  }

  // Disable/grey AI button for free users
  const aiBtn = document.getElementById('ai-gen-btn');
  if (aiBtn) {
    aiBtn.style.opacity = limits.canUseAI ? '1' : '0.5';
    aiBtn.title = limits.canUseAI ? '' : 'Upgrade to Starter or Pro to use AI captions';
  }
}

async function startCheckout(priceId) {
  if (!user) return;
  const btns = document.querySelectorAll('[data-price="' + priceId + '"]');
  btns.forEach(b => { b.disabled = true; b.innerHTML = '<span class="spinner"></span>'; });
  try {
    const res = await fetch('https://aajkbqmzuqfzzugjmerp.supabase.co/functions/v1/stripe-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SB_KEY },
      body: JSON.stringify({ price_id: priceId, user_id: user.id, email: user.email })
    });
    const json = await res.json();
    if (json.error) {
      toast(json.error, 'error');
      btns.forEach(b => { b.disabled = false; b.textContent = 'Start Free Trial'; });
      return;
    }
    window.location.href = json.url;
  } catch (e) {
    toast('Checkout failed: ' + e.message, 'error');
    btns.forEach(b => { b.disabled = false; b.textContent = 'Start Free Trial'; });
  }
}

function devSetPlan(plan) {
  userPlan = plan;
  updatePlanUI();
  // Update active button style
  ['free', 'starter', 'pro'].forEach(p => {
    const btn = document.getElementById('dev-btn-' + p);
    if (!btn) return;
    if (p === plan) {
      btn.style.background = 'var(--primary)';
      btn.style.borderColor = 'var(--primary)';
      btn.style.color = '#fff';
    } else {
      btn.style.background = 'rgba(255,255,255,0.08)';
      btn.style.borderColor = 'rgba(255,255,255,0.2)';
      btn.style.color = 'var(--text-main)';
    }
  });
  toast('Dev mode: viewing as ' + plan.charAt(0).toUpperCase() + plan.slice(1) + ' plan', 'success');
}

function checkUpgradePrompts() {
  if (userPlan !== 'free') return;

  // First login - show immediately
  if (!localStorage.getItem('pa_upgrade_shown_first')) {
    localStorage.setItem('pa_upgrade_shown_first', '1');
    if (!localStorage.getItem('pa_signup_date')) {
      localStorage.setItem('pa_signup_date', Date.now().toString());
    }
    setTimeout(() => showUpgradePrompt('trial'), 3000);
    return;
  }

  // Record signup date if not already set
  if (!localStorage.getItem('pa_signup_date')) {
    localStorage.setItem('pa_signup_date', Date.now().toString());
  }

  const signupDate = parseInt(localStorage.getItem('pa_signup_date') || '0', 10);
  const daysSince = (Date.now() - signupDate) / (1000 * 60 * 60 * 24);

  // After 1 week
  if (daysSince >= 7 && !localStorage.getItem('pa_upgrade_shown_week1')) {
    localStorage.setItem('pa_upgrade_shown_week1', '1');
    setTimeout(() => showUpgradePrompt('trial'), 3000);
    return;
  }

  // After 3 weeks
  if (daysSince >= 21 && !localStorage.getItem('pa_upgrade_shown_week3')) {
    localStorage.setItem('pa_upgrade_shown_week3', '1');
    setTimeout(() => showUpgradePrompt('trial'), 3000);
  }
}

function showUpgradePrompt(reason) {
  const msgs = {
    posts:     'You have reached the 10-post limit on the Free plan. Upgrade to schedule unlimited posts.',
    tiktok:    'TikTok scheduling requires a Starter or Pro plan.',
    both:      'Posting to both platforms at once requires a Pro plan.',
    ai:        'AI caption generation is a Starter and Pro feature. Upgrade to auto-generate captions and hashtags from your photos.',
    trial:     'Try PostAway Starter free for 5 days - no commitment. Add your card now and cancel any time before day 5 and you will never be charged.',
    firstpost: 'Nice, your first post is scheduled! Ready to unlock unlimited posts and more platforms? Try Starter free for 5 days - cancel before day 5 and you will not be charged a thing.'
  };
  const modal = document.getElementById('upgrade-modal');
  const msgEl = document.getElementById('upgrade-modal-msg');
  if (modal) {
    if (msgEl) msgEl.textContent = msgs[reason] || 'Upgrade to unlock this feature.';
    modal.style.display = 'flex';
  } else {
    toast((msgs[reason] || 'Upgrade to unlock this feature.') + ' Go to Profile to upgrade.', 'error');
    switchTab('profile');
  }
}

function closeUpgradeModal() {
  const modal = document.getElementById('upgrade-modal');
  if (modal) modal.style.display = 'none';
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

// ---- ANALYTICS ----
let analyticsPeriod = 30;
let followerChart = null;
let engagementChart = null;

function setAnalyticsPeriod(days, btn) {
  analyticsPeriod = days;
  document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const labels = { 7: 'Last 7 days', 30: 'Last 30 days', 90: 'Last 90 days' };
  const el = document.getElementById('analytics-period-label');
  if (el) el.textContent = labels[days] || 'Last ' + days + ' days';
  renderAnalyticsCharts();
}

function renderAnalytics() {
  // Reset scorecard values
  ['ac-posts','ac-likes','ac-followers','ac-reach'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '--';
  });
  ['ac-posts-d','ac-likes-d','ac-followers-d','ac-reach-d'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });

  // Try to load real data from Supabase
  loadAnalyticsData();
  renderAnalyticsCharts();
  renderHeatmap();
}

async function loadAnalyticsData() {
  if (!user) return;
  try {
    const since = new Date(Date.now() - analyticsPeriod * 86400000).toISOString();
    const { data } = await sb.from('scheduled_posts')
      .select('platform, scheduled_at, status')
      .eq('user_id', user.id)
      .gte('scheduled_at', since)
      .eq('status', 'published');
    if (!data) return;
    const postEl = document.getElementById('ac-posts');
    if (postEl) postEl.textContent = data.length || '0';
  } catch(e) { /* no data yet */ }
}

function renderAnalyticsCharts() {
  const noDataLabels = ['Week 1','Week 2','Week 3','Week 4'];
  const emptyData = [0,0,0,0];

  // Follower Growth chart
  const fCanvas = document.getElementById('chart-followers');
  if (fCanvas) {
    if (followerChart) { followerChart.destroy(); followerChart = null; }
    followerChart = new Chart(fCanvas, {
      type: 'line',
      data: {
        labels: noDataLabels,
        datasets: [
          { label: 'Instagram', data: emptyData, borderColor: '#E1306C', backgroundColor: 'rgba(225,48,108,0.08)', tension: 0.4, pointRadius: 4 },
          { label: 'TikTok',    data: emptyData, borderColor: '#010101', backgroundColor: 'rgba(0,0,0,0.05)',       tension: 0.4, pointRadius: 4 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
  }

  // Engagement chart
  const eCanvas = document.getElementById('chart-engagement');
  if (eCanvas) {
    if (engagementChart) { engagementChart.destroy(); engagementChart = null; }
    engagementChart = new Chart(eCanvas, {
      type: 'bar',
      data: {
        labels: noDataLabels,
        datasets: [
          { label: 'Likes', data: emptyData, backgroundColor: 'rgba(124,63,204,0.7)', borderRadius: 6 },
          { label: 'Comments', data: emptyData, backgroundColor: 'rgba(201,168,76,0.7)', borderRadius: 6 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
  }
}

function renderHeatmap() {
  const container = document.getElementById('heatmap-container');
  if (!container) return;
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const hours = ['6am','9am','12pm','3pm','6pm','9pm'];
  let html = '<div style="display:grid;grid-template-columns:32px repeat(6,1fr);gap:4px;font-size:11px;">';
  html += '<div></div>';
  hours.forEach(h => { html += '<div style="text-align:center;color:var(--muted,#888);padding-bottom:4px;">' + h + '</div>'; });
  days.forEach(d => {
    html += '<div style="color:var(--muted,#888);display:flex;align-items:center;">' + d + '</div>';
    hours.forEach(() => {
      html += '<div style="background:var(--border,#eee);border-radius:4px;height:28px;opacity:0.4;"></div>';
    });
  });
  html += '</div><p style="font-size:12px;color:var(--muted,#888);margin-top:12px;text-align:center;">Post data will populate this chart once you publish content.</p>';
  container.innerHTML = html;
}
