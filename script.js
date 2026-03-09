// Select the hamburger and the navigation menu elements from the HTML
const hamburger = document.querySelector(".hamburger");
const navMenu = document.querySelector("#nav-menu");

// Add an event listener for the 'click' event on the hamburger icon
hamburger.addEventListener("click", () => {
    // When clicked, toggle the 'active' class on the navigation menu
    navMenu.classList.toggle("active");
});

/* --------------------------
 * Map + behaviour (from first file)
 * integrated with reports UI (from second file)
 * -------------------------- */

// Map init (neutral world view)
const map = L.map('map').setView([20, 0], 2);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);

// Layers
const userLayer = L.layerGroup().addTo(map);
const markerLayer = L.layerGroup().addTo(map); // used by report list

// UI elements
const reportsEl = document.getElementById('reports');
const countEl = document.getElementById('count');
const liveSummary = document.getElementById('liveSummary');
let reports = []; // {id, data, marker}
let userCoords = null;
let clickedLatLng = null;

// escape helper
function escapeHtml(s) { if (!s) return ''; return String(s).replace(/[&<>\"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch])); }

// Add report to map + UI (based on second file's addReport)
function addReport(data, openPopup = false) {
    if (!data || !isFinite(Number(data.lat))) return;
    data.lat = Number(data.lat); data.lng = Number(data.lng);
    const id = data.id || Date.now() + Math.random();
    const marker = L.marker([data.lat, data.lng]).addTo(markerLayer);

    const popupHtml = `<b>Warning:</b> ${escapeHtml(data.warning || data.text || 'None')}<br>` +
        `<b>Rainfall:</b> ${escapeHtml(data.rainfall || 'N/A')}<br>` +
        (data.notes ? `<b>Notes:</b> ${escapeHtml(data.notes)}<br>` : '') +
        `<small>${data.lat.toFixed(6)}, ${data.lng.toFixed(6)}</small>`;
    marker.bindPopup(popupHtml);

    marker.on('mouseover', () => marker.openPopup());
    marker.on('mouseout', () => marker.closePopup());

    reports.unshift({ id, data, marker });
    if (reports.length > 200) {
        const old = reports.pop();
        markerLayer.removeLayer(old.marker);
    }
    renderReports();
    if (openPopup) marker.openPopup();
}

function renderReports(filter) {
    reportsEl.innerHTML = '';
    const visible = filter ? reports.filter(r => ((r.data.warning || r.data.text || '').toLowerCase().includes(filter.toLowerCase()))) : reports;
    visible.forEach(r => {
        const el = document.createElement('div');
        el.className = 'item';
        el.innerHTML = `<strong>${escapeHtml(r.data.warning || r.data.text || 'No warning')}</strong><small>${r.data.rainfall ? r.data.rainfall + ' mm' : ''} · ${new Date(r.id).toLocaleString()}</small>`;
        el.onclick = () => { map.flyTo([r.data.lat, r.data.lng], 14, { duration: 0.6 }); r.marker.openPopup(); };
        reportsEl.appendChild(el);
    });
    countEl.textContent = visible.length;
    liveSummary.textContent = reports.length ? `${reports.length} report(s) — latest: ${reports[0].data.warning || reports[0].data.text || 'No warning'}` : 'No reports yet.';
}

// WebSocket: uses same-host WS (like first file)
const proto = location.protocol === 'https:' ? 'wss' : 'ws';
const wsUrl = `${proto}://${location.host}`; // adjust if your WS runs elsewhere
let ws;
function connectWs() {
    try {
        ws = new WebSocket(wsUrl);
    } catch (e) { console.warn('WS create failed', e); return; }
    ws.addEventListener('open', () => console.log('WS open'));
    ws.addEventListener('close', () => { console.log('WS closed — retry in 3s'); setTimeout(connectWs, 3000); });
    ws.addEventListener('error', (e) => console.warn('WS error', e));
    ws.addEventListener('message', (ev) => {
        try {
            const data = JSON.parse(ev.data);
            // support multiple message shapes:
            if (data.type === 'init' && Array.isArray(data.locations)) {
                data.locations.forEach(loc => {
                    // original structure may be {lat,lng,text,ts}
                    addReport({ lat: Number(loc.lat), lng: Number(loc.lng), warning: loc.text || loc.warning, rainfall: loc.rainfall, notes: loc.notes }, false);
                });
            } else if (data.type === 'mark' && isFinite(data.lat) && isFinite(data.lng)) {
                addReport({ lat: Number(data.lat), lng: Number(data.lng), warning: data.text || data.warning, notes: data.notes }, true);
            } else if (isFinite(data.lat) && isFinite(data.lng)) {
                // generic {lat,lng,warning,rainfall,notes}
                addReport(data, true);
            }
        } catch (err) { console.warn('Bad WS message', err); }
    });
}
connectWs();

// Map click -> open floating form (use second's modal)
const dataForm = document.getElementById('dataForm');
const warningInput = document.getElementById('warning');
const rainfallInput = document.getElementById('rainfall');
const notesInput = document.getElementById('notes');
const addBtn = document.getElementById('addBtn');
const sendBtn = document.getElementById('sendBtn');
const cancelBtn = document.getElementById('cancelBtn');
const centerBtn = document.getElementById('centerBtn');

map.on('click', (e) => {
    clickedLatLng = e.latlng;
    openForm();
});

addBtn.addEventListener('click', () => {
    clickedLatLng = map.getCenter();
    openForm();
});

centerBtn.addEventListener('click', () => {
    if (userCoords) map.setView([userCoords.lat, userCoords.lng], 11);
    else map.setView(map.getCenter(), map.getZoom());
});

function openForm() {
    dataForm.style.display = 'block';
    dataForm.setAttribute('aria-hidden', 'false');
    warningInput.value = '';
    rainfallInput.value = '';
    notesInput.value = '';
    warningInput.focus();
}
cancelBtn.addEventListener('click', () => { dataForm.style.display = 'none'; clickedLatLng = null; });

sendBtn.addEventListener('click', () => {
    if (!clickedLatLng) return;
    const payload = {
        type: 'mark',         // <-- add this
        lat: Number(clickedLatLng.lat),
        lng: Number(clickedLatLng.lng),
        text: warningInput.value.trim() || 'No warning',  // backend uses 'text'
        notes: notesInput.value.trim(),                    // optional, won't break backend
        rainfall: rainfallInput.value.trim()               // optional, won't break backend
    };

    // send via WS if open
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));

    // locally add
    addReport({ lat: payload.lat, lng: payload.lng, warning: payload.text, rainfall: payload.rainfall, notes: payload.notes }, true);
    dataForm.style.display = 'none';
    clickedLatLng = null;
});

document.getElementById('search').addEventListener('input', (e) => renderReports(e.target.value));
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { dataForm.style.display = 'none'; clickedLatLng = null; } });

// Geolocation: mark user and draw 10km circle (from first & second)
function showError(e) { console.warn('Location error', e); }
if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(pos => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        userCoords = { lat, lng };
        userLayer.clearLayers();
        const icon = L.divIcon({ className: 'red-dot', iconSize: [16, 16], iconAnchor: [8, 8] });
        L.marker([lat, lng], { icon }).addTo(userLayer).bindPopup('You are here').openPopup();
        L.circle([lat, lng], { radius: 10000, color: '#d71920', weight: 2, fillOpacity: 0.06 }).addTo(userLayer);

        // if no reports yet, zoom closer
        if (reports.length === 0) map.flyTo([lat, lng], 13, { duration: 0.6 });
        else {
            const combined = L.featureGroup([userLayer, markerLayer]);
            try { map.fitBounds(combined.getBounds(), { padding: [20, 20], maxZoom: 15 }); }
            catch (e) { map.setView([lat, lng], 13); }
        }
    }, showError, { enableHighAccuracy: true, timeout: 15000 });
} else {
    console.warn('Geolocation not supported by your browser.');
}

// seed example (keeps from second file)
addReport({ lat: 28.7041, lng: 77.1025, warning: 'Heavy rain', rainfall: '48', notes: 'Stay cautious near low-lying areas' }, false);

/* ============================================= */
/* LOGIN & SIGNUP MODAL SCRIPT                   */
/* ============================================= */

// Get all the necessary elements
const mainContent = document.getElementById('main-content-wrapper');

// Login Modal Elements
const loginModal = document.getElementById('loginModal');
const signInBtn = document.getElementById('signInBtn');
const closeLoginBtn = loginModal.querySelector('.close-btn');

// SignUp Modal Elements
const signUpModal = document.getElementById('signUpModal');
const signUpBtn = document.getElementById('signUpBtn');
const closeSignUpBtn = signUpModal.querySelector('.close-btn');

// Switching Links
const switchToSignUp = document.getElementById('switchToSignUp');
const switchToLogin = document.getElementById('switchToLogin');

// --- Functions to Open Modals ---
function openLoginModal() {
    loginModal.style.display = 'flex';
    mainContent.classList.add('blur-background');
}

function openSignUpModal() {
    signUpModal.style.display = 'flex';
    mainContent.classList.add('blur-background');
}

// --- Functions to Close Modals ---
function closeLoginModal() {
    loginModal.style.display = 'none';
    if (signUpModal.style.display !== 'flex') {
        mainContent.classList.remove('blur-background');
    }
}

function closeSignUpModal() {
    signUpModal.style.display = 'none';
    if (loginModal.style.display !== 'flex') {
        mainContent.classList.remove('blur-background');
    }
}

// --- Event Listeners ---
signInBtn.addEventListener('click', openLoginModal);
signUpBtn.addEventListener('click', openSignUpModal);

closeLoginBtn.addEventListener('click', closeLoginModal);
closeSignUpBtn.addEventListener('click', closeSignUpModal);

// Switch from Login to SignUp
switchToSignUp.addEventListener('click', (e) => {
    e.preventDefault();
    closeLoginModal();
    openSignUpModal();
});

// Switch from SignUp to Login
switchToLogin.addEventListener('click', (e) => {
    e.preventDefault();
    closeSignUpModal();
    openLoginModal();
});

// Close modals if the user clicks outside of the form
window.addEventListener('click', function(event) {
    if (event.target == loginModal) {
        closeLoginModal();
    }
    if (event.target == signUpModal) {
        closeSignUpModal();
    }
});