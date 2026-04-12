// timer.js — Minuteur plein écran pour l'onglet "Minuteur"
// API: initTimer() — initialise les contrôles et l'affichage

let intervalId = null
let remainingMs = 0
let endTs = null
const NAV_LABEL = '⏱ Minuteur'

function updateNavButton () {
  try {
    const btn = document.querySelector('nav button[data-screen="timer"]')
    if (!btn) return
    if (endTs && remainingMs > 0) {
      btn.textContent = '⏱ ' + formatTime(remainingMs)
    } else {
      btn.textContent = NAV_LABEL
    }
  } catch (_) {}
}

function flashNavButton () {
  try {
    const btn = document.querySelector('nav button[data-screen="timer"]')
    if (!btn) return
    btn.textContent = '⏱ 00:00'
    btn.classList.add('timer-nav-flash')
    // stop flashing when user clicks the button
    const stop = () => {
      btn.classList.remove('timer-nav-flash')
      btn.textContent = NAV_LABEL
      btn.removeEventListener('click', stop)
    }
    btn.addEventListener('click', stop)
    // auto-stop after 30s
    setTimeout(() => stop(), 30000)
  } catch (_) {}
}

function formatTime(ms) {
  if (ms < 0) ms = 0
  const totalSec = Math.ceil(ms / 1000)
  const hh = Math.floor(totalSec / 3600)
  const mm = Math.floor((totalSec % 3600) / 60)
  const ss = totalSec % 60
  if (hh > 0) return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`
  return `${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`
}

function renderDisplay(el) {
  if (!el) return
  el.textContent = formatTime(remainingMs)
}

function playBell () {
  // "Old bell" style sonnerie ≈ 3s using inharmonic partials + long decay
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const now = ctx.currentTime
    const totalDur = 3.2

    const master = ctx.createGain()
    master.gain.setValueAtTime(0.0001, now)
    master.gain.linearRampToValueAtTime(1.0, now + 0.01)
    master.gain.exponentialRampToValueAtTime(0.0001, now + totalDur)
    master.connect(ctx.destination)

    // small reverberant feel using simple feedback delay
    const delay = ctx.createDelay(0.5)
    delay.delayTime.value = 0.08
    const fb = ctx.createGain()
    fb.gain.value = 0.25
    delay.connect(fb); fb.connect(delay)
    delay.connect(master)

    // Helper to create a bell partial (frequency ratio, amplitude, decay)
    const createPartial = (freq, amp, decay) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.setValueAtTime(freq, now)
      g.gain.setValueAtTime(0.0001, now)
      g.gain.exponentialRampToValueAtTime(amp, now + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, now + decay)
      o.connect(g)
      g.connect(delay)
      g.connect(master)
      o.start(now)
      o.stop(now + decay + 0.05)
    }

    // Fundamental and inharmonic partials (slightly detuned)
    const base = 220 // A3-ish for old bell
    createPartial(base * 1.0, 0.9, 2.8)
    createPartial(base * 2.02, 0.6, 2.6)
    createPartial(base * 2.7, 0.45, 2.2)
    createPartial(base * 3.9, 0.3, 1.8)
    createPartial(base * 5.1, 0.2, 1.5)

    // add a low rumble transient for body
    const rumble = ctx.createOscillator()
    const rg = ctx.createGain()
    rumble.type = 'sine'
    rumble.frequency.setValueAtTime(60, now)
    rg.gain.setValueAtTime(0.0001, now)
    rg.gain.linearRampToValueAtTime(0.18, now + 0.01)
    rg.gain.exponentialRampToValueAtTime(0.0001, now + 2.6)
    rumble.connect(rg); rg.connect(master)
    rumble.start(now); rumble.stop(now + 2.7)

    // cleanup
    setTimeout(() => { try { ctx.close() } catch (_) {} }, (totalDur + 0.6) * 1000)
  } catch (e) { /* ignore audio errors */ }
}

// Play the bell `count` times in sequence, spacing by ~totalDur+0.2s
function playBellRepeat(count = 1) {
  try {
    const interval = 60 
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        try { playBell() } catch (_e) {}
      }, i * interval)
    }
  } catch (e) { /* ignore */ }
}

function tick(displayEl) {
  if (!endTs) return
  remainingMs = endTs - Date.now()
  renderDisplay(displayEl)
  updateNavButton()
  if (remainingMs <= 0) {
    stopTimer()
    // visual signal: add done class briefly
    try {
      displayEl.classList.add('timer-done')
      setTimeout(() => displayEl.classList.remove('timer-done'), 1500)
    } catch (_) {}
    // flash nav button
    flashNavButton()
    // play bell sound repeated (user requested) only if sound enabled
    try { if (isSoundEnabled()) playBellRepeat(30) } catch (_e) {}
  }
}

export function startTimer(seconds, displayEl) {
  if (intervalId) stopTimer()
  remainingMs = Math.max(0, (seconds || 0) * 1000)
  endTs = Date.now() + remainingMs
  renderDisplay(displayEl)
  intervalId = setInterval(() => tick(displayEl), 200)
}

export function stopTimer() {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
  endTs = null
  updateNavButton()
}

export function resetTimer(displayEl) {
  stopTimer()
  remainingMs = 0
  renderDisplay(displayEl)
  updateNavButton()
}

export function initTimer () {
  try {
    const screen = document.getElementById('screen-timer')
    if (!screen) return
    const displayEl = screen.querySelector('.timer-display')
    const inputMinutes = screen.querySelector('#timer-minutes')
    const btnStart = screen.querySelector('#timer-start')
    const btnStop = screen.querySelector('#timer-stop')
    const btnReset = screen.querySelector('#timer-reset')
    const quickSecondsInput = screen.querySelector('#timer-quick-seconds')
    const quickStartBtn = screen.querySelector('#timer-quick-start')
    const quick45 = screen.querySelector('#timer-45') || screen.querySelector('.timer-quick-below #timer-45')
    const quick50 = screen.querySelector('#timer-50') || screen.querySelector('.timer-quick-below #timer-50')
    const quick55 = screen.querySelector('#timer-55') || screen.querySelector('.timer-quick-below #timer-55')
    const quick60 = screen.querySelector('#timer-60') || screen.querySelector('.timer-quick-below #timer-60')

    if (!displayEl || !inputMinutes || !btnStart || !btnStop || !btnReset) return

    // local handlers
    btnStart.addEventListener('click', () => {
      const mins = Number(inputMinutes.value || 0)
      const sec = Math.max(0, Math.floor(mins * 60))
      startTimer(sec, displayEl)
    })
    btnStop.addEventListener('click', () => stopTimer())
    btnReset.addEventListener('click', () => { resetTimer(displayEl); inputMinutes.value = '' })

    // Quick templates: set minutes and start immediately
    const attachQuick = (el, mins) => {
      if (!el) return
      el.addEventListener('click', () => {
        inputMinutes.value = String(mins)
        startTimer(mins * 60, displayEl)
      })
    }
    // Quick-duration control: read seconds from input and start immediately
    if (quickStartBtn && quickSecondsInput) {
      // restore persisted quick seconds if present
      try {
        const storedQuick = localStorage.getItem('tarot_timer_quick_seconds')
        if (storedQuick && !Number.isNaN(Number(storedQuick))) quickSecondsInput.value = String(Number(storedQuick))
      } catch (_e) { /* ignore */ }

      // persist when input changes
      quickSecondsInput.addEventListener('change', () => {
        try {
          const v = Math.max(1, Math.floor(Number(quickSecondsInput.value) || 0))
          quickSecondsInput.value = String(v)
          localStorage.setItem('tarot_timer_quick_seconds', String(v))
        } catch (_e) { /* ignore */ }
      })

      quickStartBtn.addEventListener('click', () => {
        const s = Math.max(1, Math.floor(Number(quickSecondsInput.value || 0)))
        if (s > 0) {
          // persist chosen quick value
          try { localStorage.setItem('tarot_timer_quick_seconds', String(s)) } catch (_e) {}
          inputMinutes.value = ''
          startTimer(s, displayEl)
        }
      })

      // also allow Enter on the input
      quickSecondsInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') quickStartBtn.click() })
    }
    attachQuick(quick45, 45)
    attachQuick(quick50, 50)
    attachQuick(quick55, 55)
    attachQuick(quick60, 60)

    // Sound toggle (persisted)
    const soundCb = screen.querySelector('#timer-sound-cb')
    try {
      const stored = localStorage.getItem('tarot_timer_sound')
      if (soundCb) soundCb.checked = stored === null ? true : stored === '1'
      if (soundCb) soundCb.addEventListener('change', () => {
        try { localStorage.setItem('tarot_timer_sound', soundCb.checked ? '1' : '') } catch (_e) {}
      })
    } catch (_e) { /* ignore */ }

    // keep display updated when tab becomes visible
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) renderDisplay(displayEl)
    })

    // initialize display
    resetTimer(displayEl)
  } catch (e) {
    /* ignore init errors */
  }
}

// Helper: check whether sound is enabled
function isSoundEnabled() {
  try { const v = localStorage.getItem('tarot_timer_sound'); return v === null ? true : v === '1' } catch (_e) { return true }
}


export default initTimer
