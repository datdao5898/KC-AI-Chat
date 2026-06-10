(function () {
  const currentScript = document.currentScript;
  const apiBase = currentScript && currentScript.src ? new URL(currentScript.src).origin : window.location.origin;
  const siteName = String(currentScript?.dataset?.siteName || '').trim();
  const siteBrandNames = {
    newlite: 'NewLite',
    kingcom: 'KingCom'
  };
  const siteThemes = {
    newlite: {
      primary: '#ff2d94',
      primaryDark: '#d91f79',
      primarySoft: '#ffe3f0',
      primaryRgb: '255, 45, 148'
    },
    kingcom: {
      primary: '#007f7b',
      primaryDark: '#005f5c',
      primarySoft: '#e6f7f6',
      primaryRgb: '0, 127, 123'
    }
  };
  const siteTheme = siteThemes[siteName.toLowerCase()] || siteThemes.kingcom;
  const widgetTitle = currentScript?.dataset?.title
    || siteBrandNames[siteName.toLowerCase()]
    || 'KingCom';
  const agentName = currentScript?.dataset?.agentName || widgetTitle;
  const externalLauncherSelector = currentScript?.dataset?.launcher || '';
  const widgetId = 'kc-chat-widget';
  const styleId = 'kc-chat-widget-style';

  if (document.getElementById(widgetId)) return;

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600;700&display=swap');

    #kc-chat-widget, #kc-chat-launcher {
      box-sizing: border-box;
      font-family: "Quicksand", Arial, Helvetica, sans-serif;
      letter-spacing: 0;
    }
    #kc-chat-widget * {
      box-sizing: border-box;
      letter-spacing: 0;
    }
    #kc-chat-widget {
      position: fixed;
      right: 20px;
      bottom: 20px;
      width: min(420px, calc(100vw - 32px));
      height: min(620px, calc(100vh - 40px));
      background: #f8fafc;
      color: #0f172a;
      border: 1px solid #dbe7f0;
      border-radius: 18px;
      box-shadow: 0 24px 60px rgba(15, 23, 42, 0.26);
      z-index: 99999;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    #kc-chat-widget.kc-closed {
      display: none;
    }
    .kc-head {
      min-height: 56px;
      padding: 0 14px 0 16px;
      background: var(--kc-primary);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-weight: 700;
      font-size: 16px;
    }
    .kc-title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .kc-minimize {
      width: 34px;
      height: 34px;
      border: 0;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.16);
      color: #fff;
      cursor: pointer;
      font-size: 22px;
      line-height: 1;
    }
    .kc-minimize:hover {
      background: rgba(255, 255, 255, 0.24);
    }
    .kc-messages {
      flex: 1;
      overflow: auto;
      padding: 16px;
      background: #eef6f8;
      scrollbar-width: thin;
      scrollbar-color: #94a3b8 transparent;
    }
    .kc-lead {
      padding: 12px 14px;
      background: #ffffff;
      border-bottom: 1px solid #dbe7f0;
    }
    .kc-lead-title {
      margin: 0 0 8px;
      color: #0f172a;
      font-size: 13px;
      font-weight: 700;
      line-height: 1.35;
    }
    .kc-lead-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .kc-lead-input {
      min-width: 0;
      height: 38px;
      padding: 0 10px;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      color: #0f172a;
      font-size: 13px;
      outline: none;
    }
    .kc-lead-input:focus {
      border-color: var(--kc-primary);
      box-shadow: 0 0 0 3px rgba(var(--kc-primary-rgb), 0.12);
    }
    .kc-row {
      display: flex;
      flex-direction: column;
      margin: 0 0 12px;
      max-width: 100%;
    }
    .kc-row-user {
      align-items: flex-end;
    }
    .kc-row-bot {
      align-items: flex-start;
    }
    .kc-name {
      margin: 0 0 4px;
      color: #64748b;
      font-size: 12px;
      font-weight: 700;
    }
    .kc-bubble {
      max-width: 86%;
      padding: 10px 12px;
      border-radius: 14px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      word-break: break-word;
      line-height: 1.42;
      font-size: 14px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
    }
    .kc-row-user .kc-bubble {
      background: var(--kc-primary);
      color: #fff;
      border-bottom-right-radius: 5px;
    }
    .kc-row-bot .kc-bubble {
      background: #fff;
      color: #0f172a;
      border: 1px solid #e2e8f0;
      border-bottom-left-radius: 5px;
    }
    .kc-bubble a {
      display: inline-flex;
      align-items: center;
      max-width: 100%;
      margin: 2px 0;
      padding: 4px 8px;
      border-radius: 999px;
      background: var(--kc-primary-soft);
      color: var(--kc-primary-dark);
      font-weight: 700;
      text-decoration: none;
      vertical-align: baseline;
    }
    .kc-bubble a:hover {
      text-decoration: underline;
    }
    .kc-message-images {
      display: grid;
      gap: 7px;
      margin-top: 8px;
    }
    .kc-message-images img {
      display: block;
      width: min(240px, 100%);
      max-height: 260px;
      object-fit: contain;
      border-radius: 10px;
      background: #f8fafc;
    }
    .kc-form {
      display: flex;
      gap: 8px;
      padding: 12px;
      border-top: 1px solid #dbe7f0;
      background: #fff;
    }
    .kc-attach {
      width: 42px;
      height: 42px;
      flex: 0 0 42px;
      display: inline-grid;
      place-items: center;
      padding: 0;
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      color: var(--kc-primary);
      background: #fff;
      cursor: pointer;
    }
    .kc-attach:hover {
      border-color: var(--kc-primary);
      background: var(--kc-primary-soft);
    }
    .kc-attach:disabled {
      cursor: wait;
      opacity: 0.55;
    }
    .kc-attach svg {
      width: 20px;
      height: 20px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .kc-attachment-preview {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-top: 1px solid #dbe7f0;
      background: #fff;
    }
    .kc-attachment-preview[hidden] {
      display: none;
    }
    .kc-attachment-preview img {
      width: 54px;
      height: 54px;
      flex: 0 0 54px;
      object-fit: cover;
      border: 1px solid #dbe7f0;
      border-radius: 10px;
      background: #f8fafc;
    }
    .kc-attachment-info {
      min-width: 0;
      flex: 1;
    }
    .kc-attachment-name {
      overflow: hidden;
      color: #0f172a;
      font-size: 12px;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .kc-attachment-note {
      margin-top: 3px;
      color: #64748b;
      font-size: 11px;
    }
    .kc-attachment-remove {
      width: 30px;
      height: 30px;
      flex: 0 0 30px;
      border: 1px solid #cbd5e1;
      border-radius: 9px;
      color: #475569;
      background: #fff;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
    }
    .kc-input {
      min-width: 0;
      flex: 1;
      height: 42px;
      padding: 0 12px;
      border-radius: 12px;
      border: 1px solid #cbd5e1;
      color: #0f172a;
      font-size: 14px;
      outline: none;
    }
    .kc-input:focus {
      border-color: var(--kc-primary);
      box-shadow: 0 0 0 3px rgba(var(--kc-primary-rgb), 0.14);
    }
    .kc-send {
      width: 58px;
      height: 42px;
      border: 0;
      border-radius: 12px;
      background: #0f172a;
      color: #fff;
      cursor: pointer;
      font-weight: 700;
      font-size: 14px;
    }
    .kc-send:disabled {
      cursor: wait;
      opacity: 0.64;
    }
    #kc-chat-launcher {
      position: fixed;
      right: 20px;
      bottom: 20px;
      min-width: 96px;
      height: 46px;
      border: 0;
      border-radius: 999px;
      background: var(--kc-primary);
      color: #fff;
      box-shadow: 0 18px 45px rgba(var(--kc-primary-rgb), 0.32);
      cursor: pointer;
      font-weight: 700;
      z-index: 99999;
      display: none;
    }
    @media (max-width: 520px) {
      #kc-chat-widget {
        top: var(--kc-mobile-top, 0px);
        right: 0;
        bottom: auto;
        left: 0;
        width: 100%;
        height: 100vh;
        height: var(--kc-mobile-height, 100dvh);
        max-height: none;
        border: 0;
        border-radius: 0;
        box-shadow: none;
      }
      .kc-head {
        min-height: calc(56px + env(safe-area-inset-top));
        padding-top: env(safe-area-inset-top);
        flex: 0 0 auto;
      }
      .kc-lead {
        flex: 0 0 auto;
      }
      .kc-messages {
        min-height: 0;
        overscroll-behavior: contain;
      }
      .kc-bubble {
        max-width: 92%;
        font-size: 14px;
      }
      .kc-attachment-preview {
        flex: 0 0 auto;
      }
      .kc-form {
        flex: 0 0 auto;
        padding-bottom: calc(12px + env(safe-area-inset-bottom));
      }
      #kc-chat-widget.kc-keyboard-open.kc-compose-focused .kc-lead {
        display: none;
      }
      #kc-chat-widget.kc-keyboard-open:not(.kc-compose-focused) .kc-lead-title {
        display: none;
      }
      #kc-chat-widget.kc-keyboard-open:not(.kc-compose-focused) .kc-lead-grid {
        grid-template-columns: 1fr 1fr;
      }
      #kc-chat-launcher {
        right: 12px;
        bottom: calc(12px + env(safe-area-inset-bottom));
      }
      .kc-lead-grid {
        grid-template-columns: 1fr;
      }
    }
  `;

  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
  }

  const box = document.createElement('section');
  box.id = widgetId;
  box.setAttribute('aria-label', widgetTitle);
  box.style.setProperty('--kc-primary', siteTheme.primary);
  box.style.setProperty('--kc-primary-dark', siteTheme.primaryDark);
  box.style.setProperty('--kc-primary-soft', siteTheme.primarySoft);
  box.style.setProperty('--kc-primary-rgb', siteTheme.primaryRgb);

  const head = document.createElement('div');
  head.className = 'kc-head';

  const title = document.createElement('div');
  title.className = 'kc-title';
  title.textContent = widgetTitle;

  const minimize = document.createElement('button');
  minimize.className = 'kc-minimize';
  minimize.type = 'button';
  minimize.setAttribute('aria-label', 'Thu gon widget');
  minimize.textContent = '-';

  head.append(title, minimize);

  const messages = document.createElement('div');
  messages.className = 'kc-messages';

  const lead = document.createElement('div');
  lead.className = 'kc-lead';

  const leadTitle = document.createElement('p');
  leadTitle.className = 'kc-lead-title';
  leadTitle.textContent = `Anh/chị có thể để lại tên và số điện thoại để ${widgetTitle} hỗ trợ nhanh hơn.`;

  const leadGrid = document.createElement('div');
  leadGrid.className = 'kc-lead-grid';

  const nameInput = document.createElement('input');
  nameInput.className = 'kc-lead-input';
  nameInput.placeholder = 'Tên của anh/chị';
  nameInput.autocomplete = 'name';

  const phoneInput = document.createElement('input');
  phoneInput.className = 'kc-lead-input';
  phoneInput.placeholder = 'Số điện thoại';
  phoneInput.autocomplete = 'tel';
  phoneInput.inputMode = 'tel';

  leadGrid.append(nameInput, phoneInput);
  lead.append(leadTitle, leadGrid);

  const form = document.createElement('div');
  form.className = 'kc-form';

  const attachmentPreview = document.createElement('div');
  attachmentPreview.className = 'kc-attachment-preview';
  attachmentPreview.hidden = true;

  const attachmentImage = document.createElement('img');
  attachmentImage.alt = 'Ảnh đã chọn';

  const attachmentInfo = document.createElement('div');
  attachmentInfo.className = 'kc-attachment-info';

  const attachmentName = document.createElement('div');
  attachmentName.className = 'kc-attachment-name';

  const attachmentNote = document.createElement('div');
  attachmentNote.className = 'kc-attachment-note';
  attachmentNote.textContent = 'JPG, PNG hoặc WebP, tối đa 5 MB';

  const attachmentRemove = document.createElement('button');
  attachmentRemove.className = 'kc-attachment-remove';
  attachmentRemove.type = 'button';
  attachmentRemove.setAttribute('aria-label', 'Bỏ ảnh đã chọn');
  attachmentRemove.textContent = '×';

  attachmentInfo.append(attachmentName, attachmentNote);
  attachmentPreview.append(attachmentImage, attachmentInfo, attachmentRemove);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/jpeg,image/png,image/webp';
  fileInput.hidden = true;

  const attachButton = document.createElement('button');
  attachButton.className = 'kc-attach';
  attachButton.type = 'button';
  attachButton.title = 'Gửi hình ảnh';
  attachButton.setAttribute('aria-label', 'Gửi hình ảnh');
  attachButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.4 11.6 12 21a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.3-8.3"></path></svg>';

  const input = document.createElement('input');
  input.className = 'kc-input';
  input.placeholder = 'Nhập câu hỏi...';
  input.autocomplete = 'off';

  const button = document.createElement('button');
  button.className = 'kc-send';
  button.type = 'button';
  button.textContent = 'Gửi';

  const launcher = document.createElement('button');
  launcher.id = 'kc-chat-launcher';
  launcher.type = 'button';
  launcher.textContent = 'Chat';
  launcher.style.setProperty('--kc-primary', siteTheme.primary);
  launcher.style.setProperty('--kc-primary-dark', siteTheme.primaryDark);
  launcher.style.setProperty('--kc-primary-soft', siteTheme.primarySoft);
  launcher.style.setProperty('--kc-primary-rgb', siteTheme.primaryRgb);

  form.append(attachButton, input, button, fileInput);
  box.append(head, lead, messages, attachmentPreview, form);
  document.body.append(box, launcher);

  const externalLauncher = externalLauncherSelector
    ? document.querySelector(externalLauncherSelector)
    : null;
  const vid = localStorage.kcVisitorId || (localStorage.kcVisitorId = 'web-' + Date.now());
  const renderedMessageIds = new Set();
  const mobileMedia = window.matchMedia('(max-width: 520px)');
  let lastPollAt = '';
  let isPolling = false;
  let historyLoaded = false;
  let selectedImage = null;
  let selectedPreviewUrl = '';
  let bodyOverflowBeforeChat = '';
  let htmlOverflowBeforeChat = '';
  let mobileScrollLocked = false;
  let mobileViewportBaseline = 0;
  nameInput.value = localStorage.kcCustomerName || '';
  phoneInput.value = localStorage.kcCustomerPhone || '';

  nameInput.oninput = () => saveOptionalContact();
  phoneInput.oninput = () => saveOptionalContact();
  nameInput.onkeydown = e => { if (e.key === 'Enter') input.focus(); };
  phoneInput.onkeydown = e => { if (e.key === 'Enter') input.focus(); };

  function closeChat() {
    box.classList.add('kc-closed');
    box.classList.remove('kc-keyboard-open');
    box.classList.remove('kc-compose-focused');
    clearMobileViewport();
    unlockPageScroll();
    launcher.style.display = externalLauncher ? 'none' : 'block';
    if (externalLauncher) externalLauncher.style.display = '';
  }

  function openChat() {
    launcher.style.display = 'none';
    if (externalLauncher) externalLauncher.style.display = 'none';
    box.classList.remove('kc-closed');
    syncMobileViewport();
    lockPageScroll();
    pollWebsiteMessages();
    if (!mobileMedia.matches) input.focus();
  }

  function lockPageScroll() {
    if (!mobileMedia.matches || mobileScrollLocked) return;
    bodyOverflowBeforeChat = document.body.style.overflow;
    htmlOverflowBeforeChat = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    mobileScrollLocked = true;
  }

  function unlockPageScroll() {
    if (!mobileScrollLocked) return;
    document.body.style.overflow = bodyOverflowBeforeChat;
    document.documentElement.style.overflow = htmlOverflowBeforeChat;
    mobileScrollLocked = false;
  }

  function clearMobileViewport() {
    box.style.removeProperty('--kc-mobile-height');
    box.style.removeProperty('--kc-mobile-top');
    mobileViewportBaseline = 0;
  }

  function scrollToLatestMessage() {
    window.requestAnimationFrame(() => {
      messages.scrollTop = messages.scrollHeight;
    });
  }

  function syncMobileViewport() {
    if (!mobileMedia.matches || box.classList.contains('kc-closed')) {
      box.classList.remove('kc-keyboard-open');
      clearMobileViewport();
      return;
    }

    const viewport = window.visualViewport;
    const viewportHeight = Math.max(320, Math.round(viewport?.height || window.innerHeight));
    const viewportTop = Math.max(0, Math.round(viewport?.offsetTop || 0));
    if (!mobileViewportBaseline || viewportHeight > mobileViewportBaseline) {
      mobileViewportBaseline = viewportHeight;
    }
    const keyboardOpen = mobileViewportBaseline - viewportHeight > 120;
    box.style.setProperty('--kc-mobile-height', `${viewportHeight}px`);
    box.style.setProperty('--kc-mobile-top', `${viewportTop}px`);
    box.classList.toggle('kc-keyboard-open', keyboardOpen);
    if (keyboardOpen) scrollToLatestMessage();
  }

  window.KingComChat = {
    open: openChat,
    close: closeChat,
    toggle() {
      if (box.classList.contains('kc-closed')) openChat();
      else closeChat();
    }
  };

  box.classList.add('kc-closed');
  launcher.style.display = externalLauncher ? 'none' : 'block';
  if (externalLauncher) externalLauncher.addEventListener('click', openChat);
  minimize.onclick = closeChat;
  launcher.onclick = openChat;
  window.visualViewport?.addEventListener('resize', syncMobileViewport);
  window.visualViewport?.addEventListener('scroll', syncMobileViewport);
  window.addEventListener('orientationchange', () => {
    mobileViewportBaseline = 0;
    setTimeout(syncMobileViewport, 100);
  });
  const handleMobileBreakpointChange = () => {
    if (box.classList.contains('kc-closed')) return;
    if (mobileMedia.matches) {
      syncMobileViewport();
      lockPageScroll();
    } else {
      box.classList.remove('kc-keyboard-open');
      clearMobileViewport();
      unlockPageScroll();
    }
  };
  if (mobileMedia.addEventListener) mobileMedia.addEventListener('change', handleMobileBreakpointChange);
  else mobileMedia.addListener?.(handleMobileBreakpointChange);

  async function send() {
    const text = input.value.trim();
    const imageFile = selectedImage;
    if ((!text && !imageFile) || button.disabled) return;
    const localImageUrl = imageFile ? await readFileDataUrl(imageFile) : '';
    input.value = '';
    clearSelectedImage();
    add('Bạn', text || 'Đã gửi hình ảnh', 'user', localImageUrl ? [localImageUrl] : []);
    const typing = add(agentName, 'Đang soạn...', 'bot');
    button.disabled = true;
    attachButton.disabled = true;

    try {
      const { customerName, customerPhone } = saveOptionalContact();
      const uploadedMedia = imageFile ? await uploadImage(imageFile) : null;

      const res = await fetch(`${apiBase}/webhooks/website-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorId: vid,
          message: text,
          attachments: uploadedMedia ? [{ id: uploadedMedia.id, token: uploadedMedia.token }] : [],
          name: customerName,
          phone: customerPhone,
          siteName,
          siteHost: window.location.hostname,
          siteUrl: window.location.href,
          origin: window.location.origin,
          referrer: document.referrer || ''
        })
      });

      const raw = await res.text();
      const data = raw ? JSON.parse(raw) : {};
      if (!res.ok) throw new Error(data.error || `http_${res.status}`);

      typing.remove();
      add(agentName, data.reply || 'Đã nhận tin nhắn', 'bot');
    } catch (e) {
      typing.remove();
      add(agentName, 'Xin lỗi, hiện chưa gửi được tin nhắn. Anh/chị thử lại sau ít phút giúp em nhé.', 'bot');
    } finally {
      button.disabled = false;
      attachButton.disabled = false;
      input.focus();
    }
  }

  async function uploadImage(file) {
    const res = await fetch(`${apiBase}/webhooks/website-chat/media`, {
      method: 'POST',
      headers: {
        'Content-Type': file.type,
        'X-KC-Visitor-Id': vid
      },
      body: file
    });
    const raw = await res.text();
    const data = raw ? JSON.parse(raw) : {};
    if (!res.ok || !data.media) throw new Error(data.error || `image_http_${res.status}`);
    return data.media;
  }

  function readFileDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('image_read_failed'));
      reader.readAsDataURL(file);
    });
  }

  function setSelectedImage(file) {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!file || !allowed.has(file.type)) {
      add(agentName, 'Ảnh cần có định dạng JPG, PNG hoặc WebP.', 'bot');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      add(agentName, 'Ảnh vượt quá 5 MB. Anh/chị chọn ảnh nhỏ hơn giúp em nhé.', 'bot');
      return;
    }
    clearSelectedImage();
    selectedImage = file;
    selectedPreviewUrl = URL.createObjectURL(file);
    attachmentImage.src = selectedPreviewUrl;
    attachmentName.textContent = file.name || 'Ảnh từ clipboard';
    attachmentPreview.hidden = false;
  }

  function clearSelectedImage() {
    if (selectedPreviewUrl) URL.revokeObjectURL(selectedPreviewUrl);
    selectedImage = null;
    selectedPreviewUrl = '';
    attachmentImage.removeAttribute('src');
    attachmentName.textContent = '';
    attachmentPreview.hidden = true;
    fileInput.value = '';
  }

  function saveOptionalContact() {
    const customerName = nameInput.value.trim();
    const customerPhone = phoneInput.value.trim();
    if (customerName) localStorage.kcCustomerName = customerName;
    else localStorage.removeItem('kcCustomerName');
    if (customerPhone) localStorage.kcCustomerPhone = customerPhone;
    else localStorage.removeItem('kcCustomerPhone');
    return { customerName, customerPhone };
  }

  async function pollWebsiteMessages() {
    if (isPolling) return;
    isPolling = true;
    try {
      const params = new URLSearchParams({ visitorId: vid, limit: '20' });
      if (lastPollAt) params.set('since', lastPollAt);
      const res = await fetch(`${apiBase}/webhooks/website-chat/messages?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      const isInitialHistory = !historyLoaded && !lastPollAt;
      if (isInitialHistory && Array.isArray(data.messages) && data.messages.length) {
        messages.innerHTML = '';
      }
      for (const msg of data.messages || []) {
        if (msg.created_at) lastPollAt = msg.created_at;
        if (renderedMessageIds.has(msg.id)) continue;
        renderedMessageIds.add(msg.id);
        if (isInitialHistory) {
          add(messageName(msg), msg.text, messageRole(msg), messageMediaUrls(msg));
        } else if (msg.sender_type === 'staff') {
          add(agentName, msg.text, 'bot', messageMediaUrls(msg));
        }
      }
      historyLoaded = true;
    } catch (e) {
      // Polling is best-effort; sending still reports its own errors.
    } finally {
      isPolling = false;
    }
  }

  function messageRole(msg) {
    return msg.direction === 'in' ? 'user' : 'bot';
  }

  function messageName(msg) {
    return msg.direction === 'in' ? 'Bạn' : agentName;
  }

  function messageMediaUrls(msg) {
    let raw = msg?.raw_json || {};
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch { raw = {}; }
    }
    const mediaUrls = Array.isArray(raw?._media?.imageUrls)
      ? raw._media.imageUrls
      : (Array.isArray(raw?.attachments) ? raw.attachments.map(item => item?.url) : []);
    return [...new Set(mediaUrls)]
      .filter(url => /^https:\/\//i.test(String(url || '')) || /^\/webhooks\/website-chat\/media\//i.test(String(url || '')))
      .slice(0, 3)
      .map(url => new URL(url, apiBase).href);
  }

  function add(who, text, role, imageUrls = []) {
    const row = document.createElement('div');
    row.className = `kc-row kc-row-${role || 'bot'}`;

    const name = document.createElement('div');
    name.className = 'kc-name';
    name.textContent = who;

    const bubble = document.createElement('div');
    bubble.className = 'kc-bubble';
    appendMessageContent(bubble, String(text || ''));
    if (imageUrls.length) {
      const gallery = document.createElement('div');
      gallery.className = 'kc-message-images';
      imageUrls.forEach(url => {
        const image = document.createElement('img');
        image.src = url;
        image.alt = 'Hình ảnh trong hội thoại';
        image.loading = 'lazy';
        image.addEventListener('error', () => image.remove(), { once: true });
        gallery.appendChild(image);
      });
      bubble.appendChild(gallery);
    }

    row.append(name, bubble);
    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;
    return row;
  }

  function appendMessageContent(target, text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const hasGuidanceSources = /(nguồn hướng dẫn chính hãng|nguon huong dan chinh hang|official sources|官方资料)/i.test(text);
    let lastIndex = 0;
    let match;
    const labelCounts = new Map();

    while ((match = urlRegex.exec(text)) !== null) {
      if (match.index > lastIndex) target.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      const anchor = document.createElement('a');
      anchor.href = match[0];
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      const baseLabel = linkLabel(
        match[0],
        text.slice(Math.max(0, match.index - 120), match.index),
        hasGuidanceSources
      );
      const count = (labelCounts.get(baseLabel) || 0) + 1;
      labelCounts.set(baseLabel, count);
      anchor.textContent = count === 1 ? baseLabel : `${baseLabel} ${count}`;
      target.appendChild(anchor);
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) target.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  function linkLabel(rawUrl, precedingText = '', hasGuidanceSources = false) {
    try {
      const url = new URL(rawUrl);
      const path = url.pathname.toLowerCase();
      const context = String(precedingText || '').toLowerCase();
      if (path.includes('/products/') || path.includes('/product/')) return 'Xem sản phẩm';
      if (
        hasGuidanceSources
        ||
        /(manual|guide|support|download|firmware|faq|help|instruction)/i.test(path)
        || /(hướng dẫn|huong dan|tài liệu|tai lieu|nguồn chính hãng|nguon chinh hang)/i.test(context)
      ) return 'Xem hướng dẫn';
    } catch {}
    return 'Mở liên kết';
  }

  button.onclick = send;
  attachButton.onclick = () => fileInput.click();
  fileInput.onchange = () => setSelectedImage(fileInput.files?.[0]);
  attachmentRemove.onclick = clearSelectedImage;
  input.addEventListener('focus', () => {
    box.classList.add('kc-compose-focused');
    syncMobileViewport();
    scrollToLatestMessage();
  });
  input.addEventListener('blur', () => {
    box.classList.remove('kc-compose-focused');
    setTimeout(syncMobileViewport, 100);
  });
  input.addEventListener('paste', event => {
    const image = [...(event.clipboardData?.items || [])]
      .find(item => item.kind === 'file' && String(item.type || '').startsWith('image/'));
    if (!image) return;
    event.preventDefault();
    setSelectedImage(image.getAsFile());
  });
  input.onkeydown = e => { if (e.key === 'Enter') send(); };
  add(agentName, 'Xin chào! Bạn cần tư vấn sản phẩm gì ạ?', 'bot');
  pollWebsiteMessages();
  setInterval(pollWebsiteMessages, 3000);
})();
