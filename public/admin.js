// The invitation editor. The form is built from the schema the server sends,
// so every field the server knows about can be edited here. Unsaved changes
// show in the preview, rendered by the server exactly as guests will see them.
(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const panels = ['setup', 'login', 'edit', 'wishes'];
  const IMAGE_MAX_EDGE = 2000;
  const IMAGE_KEEP_BYTES = 1_500_000;
  const AUDIO_MAX_BYTES = 20_000_000;
  const DEVICES = { phone: [390, 780], desktop: [1280, 800] };

  let schema = { groups: [], designs: [], frames: {}, templateLimit: 5 };
  let current = null;
  let dirty = false;
  let busyUploads = 0;
  let canSave = true;

  function show(name) {
    $('[data-loading]').hidden = true;
    for (const panel of panels) $(`[data-panel="${panel}"]`).hidden = panel !== name;
    $('[data-tabs]').hidden = !(name === 'edit' || name === 'wishes');
    $('[data-savebar]').hidden = name !== 'edit';
    document.querySelectorAll('[data-tab]').forEach((tab) => {
      if (tab.dataset.tab === name) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });
    if (name === 'edit') fitPreview();
  }

  async function api(method, url, body, as = 'json') {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 401 && url !== '/api/admin/login') {
      show('login');
      throw new Error('Please sign in again.');
    }
    if (as === 'text' && response.ok) return response.text();
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  function setStatus(element, text, kind) {
    element.textContent = text;
    element.className = `${element.className.split(' ')[0]}${kind ? ` is-${kind}` : ''}`;
  }

  function markDirty() {
    dirty = true;
    setStatus($('[data-save-status]'), 'You have unsaved changes.');
    schedulePreview();
  }

  window.addEventListener('beforeunload', (event) => {
    if (dirty || busyUploads) event.preventDefault();
  });

  function element(tag, props = {}, children = []) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children.filter(Boolean));
    return node;
  }

  function svgElement(tag, attributes = {}, children = []) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    node.append(...children);
    return node;
  }

  function swatches(colours) {
    return element(
      'span',
      { className: 'swatches', ariaHidden: 'true' },
      colours.map((colour) => {
        const swatch = element('i');
        swatch.style.background = colour;
        return swatch;
      }),
    );
  }

  // ---- Fields ----

  function wideField(field) {
    return ['textarea', 'image', 'audio', 'design'].includes(field.kind);
  }

  function control(field, target, id) {
    const value = target[field.key];
    const update = (next) => {
      target[field.key] = next;
      markDirty();
    };

    if (field.kind === 'design') return designPicker(target);

    if (field.kind === 'toggle') {
      const box = element('input', { type: 'checkbox', checked: Boolean(value), id });
      box.addEventListener('change', () => update(box.checked));
      return element('label', { className: 'toggle' }, [box, element('span', { textContent: field.label })]);
    }

    if (field.kind === 'color') {
      const picker = element('input', { type: 'color', value, id });
      const text = element('input', { type: 'text', value, maxLength: 7, spellcheck: false, ariaLabel: `${field.label} code` });
      picker.addEventListener('input', () => {
        text.value = picker.value;
        update(picker.value);
      });
      text.addEventListener('input', () => {
        if (/^#[0-9a-f]{6}$/i.test(text.value)) picker.value = text.value;
        update(text.value);
      });
      return element('div', { className: 'color' }, [picker, text]);
    }

    if (field.kind === 'image' || field.kind === 'audio') return mediaControl(field, target, id, update);

    const input =
      field.kind === 'textarea'
        ? element('textarea', { value, id, rows: 3 })
        : element('input', { type: { date: 'date', time: 'time', url: 'url' }[field.kind] || 'text', value, id });
    if (field.max) input.maxLength = field.max;
    if (field.required) input.required = true;
    if (field.kind === 'offset') input.placeholder = '+05:30';
    if (field.rtl) {
      input.dir = 'rtl';
      input.lang = 'ar';
    }
    input.addEventListener('input', () => update(input.value));
    return input;
  }

  /** Five ready-made looks. Picking one also loads its colours. */
  function designPicker(theme) {
    return element(
      'div',
      { className: 'designs', role: 'group', ariaLabel: 'Designs' },
      schema.designs.map((design) => {
        const { navy, ivory, mist, gold } = design.colours;
        const art = element('span', { className: 'design__art', ariaHidden: 'true' }, [
          svgElement('svg', { viewBox: '-12 -12 324 424' }, [
            svgElement('path', { d: schema.frames[design.frame], fill: design.night ? navy : mist, stroke: gold, 'stroke-width': '8' }),
          ]),
        ]);
        art.style.background = `linear-gradient(160deg, ${ivory}, ${mist})`;
        const button = element('button', { type: 'button', className: 'design' }, [
          art,
          element('span', { className: 'design__name', textContent: design.name }),
          swatches([navy, ivory, mist, gold]),
          element('span', { className: 'design__text', textContent: design.description }),
        ]);
        button.setAttribute('aria-pressed', String(theme.design === design.id));
        button.addEventListener('click', () => {
          Object.assign(theme, { design: design.id }, design.colours);
          markDirty();
          buildForm();
        });
        return button;
      }),
    );
  }

  function mediaControl(field, target, id, update) {
    const kind = field.kind;
    const preview = element('div', { className: 'media__preview' });
    const linkInput = element('input', { type: 'url', id, value: target[field.key], placeholder: 'https://…' });
    const progress = element('span', { className: 'media__progress', role: 'status' });
    const file = element('input', {
      type: 'file',
      accept: kind === 'image' ? 'image/jpeg,image/png,image/webp' : 'audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,.mp3,.m4a,.aac',
      hidden: true,
    });
    const choose = element('button', {
      type: 'button',
      className: 'secondary small',
      textContent: kind === 'image' ? 'Upload photo' : 'Upload song',
      disabled: !canSave,
    });
    const remove = element('button', { type: 'button', className: 'danger small', textContent: 'Remove' });
    // Say why the button is off, right where it is clicked.
    if (!canSave) progress.textContent = 'Uploading is off until a Blob store is connected. See the note at the top.';

    function paint() {
      const url = target[field.key];
      preview.replaceChildren();
      remove.hidden = !url;
      if (!url) preview.textContent = kind === 'image' ? 'No photo, the illustration is used' : 'No music';
      else if (kind === 'image') preview.append(element('img', { src: url, alt: '' }));
      else preview.append(element('audio', { src: url, controls: true, preload: 'none' }));
    }

    function set(url) {
      linkInput.value = url;
      update(url);
      paint();
    }

    choose.addEventListener('click', () => file.click());
    remove.addEventListener('click', () => set(''));
    linkInput.addEventListener('change', () => set(linkInput.value.trim()));
    file.addEventListener('change', async () => {
      const chosen = file.files[0];
      file.value = '';
      if (!chosen) return;
      choose.disabled = true;
      busyUploads++;
      try {
        const url = await uploadFile(chosen, kind, (text) => (progress.textContent = text));
        set(url);
        progress.textContent = 'Uploaded. Save changes to publish it.';
      } catch (error) {
        progress.textContent = error.message;
      } finally {
        busyUploads--;
        choose.disabled = false;
      }
    });

    paint();
    return element('div', { className: 'media' }, [
      preview,
      element('div', { className: 'media__buttons' }, [choose, remove, progress]),
      file,
      element('details', {}, [element('summary', { textContent: 'Or paste a link' }), linkInput]),
    ]);
  }

  function fieldBlock(field, target, idPrefix) {
    const id = `${idPrefix}-${field.key}`;
    const parts = [];
    if (field.kind !== 'toggle' && field.kind !== 'design') {
      parts.push(element('label', { className: 'field__label', htmlFor: id, textContent: field.label }));
    }
    parts.push(control(field, target, id));
    if (field.help) parts.push(element('span', { className: 'field__help', textContent: field.help }));
    return element('div', { className: `field${wideField(field) ? ' field--wide' : ''}` }, parts);
  }

  function blankItem(group) {
    const item = {};
    for (const field of group.fields) item[field.key] = field.kind === 'toggle' ? false : '';
    const previous = current[group.key][current[group.key].length - 1];
    if (previous && 'date' in item) item.date = previous.date;
    return item;
  }

  function listGroup(group) {
    const items = current[group.key];
    const box = element('div');
    const paint = () => {
      box.replaceChildren();
      items.forEach((item, index) => {
        const remove = element('button', { type: 'button', className: 'danger small', textContent: 'Remove' });
        remove.hidden = items.length <= group.list.min;
        remove.addEventListener('click', () => {
          items.splice(index, 1);
          markDirty();
          paint();
        });
        box.append(
          element('div', { className: 'item' }, [
            element('div', { className: 'item__head' }, [element('span', { textContent: `${group.list.item} ${index + 1}` }), remove]),
            element('div', { className: 'fields' }, group.fields.map((field) => fieldBlock(field, item, `${group.key}-${index}`))),
          ]),
        );
      });
      if (items.length < group.list.max) {
        const add = element('button', { type: 'button', className: 'secondary small', textContent: `Add ${group.list.item.toLowerCase()}` });
        add.style.marginTop = '14px';
        add.addEventListener('click', () => {
          items.push(blankItem(group));
          markDirty();
          paint();
        });
        box.append(add);
      }
    };
    paint();
    return box;
  }

  function buildForm() {
    const scroll = window.scrollY;
    $('[data-editor]').replaceChildren(
      ...schema.groups.map((group) =>
        element('fieldset', {}, [
          element('legend', { textContent: group.title }),
          group.help && element('p', { className: 'group-help', textContent: group.help }),
          group.list
            ? listGroup(group)
            : element('div', { className: 'fields' }, group.fields.map((field) => fieldBlock(field, current[group.key], group.key))),
        ]),
      ),
    );
    window.scrollTo(0, scroll);
  }

  // ---- Preview ----

  const frame = $('[data-preview-frame]');
  const stage = $('[data-stage]');
  const previewStatus = $('[data-preview-status]');
  let device = 'phone';
  let previewTimer;
  let previewRun = 0;
  let restore = null;

  function fitPreview() {
    const [width, height] = DEVICES[device];
    const available = stage.clientWidth - 24;
    const scale = Math.min(1, available / width, device === 'phone' ? (stage.clientHeight - 24) / height : 1);
    frame.style.width = `${width}px`;
    frame.style.height = device === 'phone' ? `${height}px` : `${Math.max(height, (stage.clientHeight - 24) / scale)}px`;
    frame.style.transform = `translateX(-50%) translateY(12px) scale(${scale > 0 ? scale : 1})`;
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 600);
  }

  async function renderPreview() {
    if (!current) return;
    const run = ++previewRun;
    setStatus(previewStatus, 'Updating…');
    try {
      const html = await api('POST', '/api/admin/preview', current, 'text');
      if (run !== previewRun) return;
      // Keep the guest's place: if the preview was open and scrolled, return there after reloading.
      try {
        const doc = frame.contentDocument;
        restore = doc?.body?.classList.contains('is-open') ? frame.contentWindow.scrollY : null;
      } catch {
        restore = null;
      }
      frame.srcdoc = html;
      setStatus(previewStatus, dirty ? 'Showing unsaved changes.' : 'Showing the saved invitation.');
    } catch (error) {
      if (run === previewRun) setStatus(previewStatus, `Preview not updated: ${error.message}`, 'error');
    }
  }

  frame.addEventListener('load', () => {
    if (restore === null) return;
    const y = restore;
    restore = null;
    try {
      const doc = frame.contentDocument;
      const cover = doc.getElementById('cover');
      if (cover) cover.hidden = true;
      doc.body.classList.remove('is-locked');
      doc.body.classList.add('is-open');
      doc.querySelector('[data-music]')?.removeAttribute('hidden');
      frame.contentWindow.scrollTo(0, y);
    } catch {
      // The preview still works; it just starts from the opening screen.
    }
  });

  document.querySelectorAll('[data-device]').forEach((button) =>
    button.addEventListener('click', () => {
      device = button.dataset.device;
      document.querySelectorAll('[data-device]').forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
      fitPreview();
    }),
  );
  $('[data-preview-reload]').addEventListener('click', () => {
    restore = null;
    frame.srcdoc = '';
    renderPreview();
  });
  $('[data-preview-open]').addEventListener('click', () => {
    $('[data-preview]').classList.add('is-open');
    fitPreview();
  });
  $('[data-preview-close]').addEventListener('click', () => $('[data-preview]').classList.remove('is-open'));
  window.addEventListener('resize', fitPreview);

  // ---- Uploads ----

  async function prepareImage(file) {
    if (!('createImageBitmap' in window)) return file;
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new Error('That photo could not be read. Please choose a JPG or PNG.');
    }
    const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    // Small photos are kept as they are; large ones are resized so guests' phones load them quickly.
    if (scale === 1 && file.size <= IMAGE_KEEP_BYTES && /jpeg|png|webp/.test(file.type)) return file;
    const canvas = element('canvas', { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('That photo could not be prepared.'))), 'image/jpeg', 0.86),
    );
  }

  async function uploadFile(file, kind, report) {
    report('Preparing…');
    const data = kind === 'image' ? await prepareImage(file) : file;
    if (kind === 'audio' && data.size > AUDIO_MAX_BYTES) throw new Error('That song is larger than 20 MB.');
    const { id, partBytes } = await api('POST', '/api/admin/uploads', {});
    const parts = Math.max(1, Math.ceil(data.size / partBytes));
    for (let index = 0; index < parts; index++) {
      report(`Uploading… ${Math.round((index / parts) * 100)}%`);
      const response = await fetch(`/api/admin/uploads/${id}/${index}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: data.slice(index * partBytes, (index + 1) * partBytes),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'The upload failed. Please try again.');
      }
    }
    report('Finishing…');
    const { url } = await api('POST', `/api/admin/uploads/${id}/finish`, { parts, kind });
    return url;
  }

  // ---- Saving ----

  $('[data-save]').addEventListener('click', async () => {
    const status = $('[data-save-status]');
    if (busyUploads) return setStatus(status, 'Please wait for the upload to finish.', 'error');
    const button = $('[data-save]');
    button.disabled = true;
    setStatus(status, 'Saving…');
    try {
      current = await api('PUT', '/api/admin/invitation', current);
      dirty = false;
      buildForm();
      setStatus(status, 'Saved. Guests see the changes within a minute.', 'ok');
      $('[data-view-link]').href = `/?v=${Date.now()}`;
      setStatus(previewStatus, 'Showing the saved invitation.');
    } catch (error) {
      setStatus(status, error.message, 'error');
    } finally {
      button.disabled = !canSave;
    }
  });

  // ---- Templates ----

  const templateStatus = $('[data-template-status]');
  const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  async function loadTemplates() {
    const list = $('[data-template-list]');
    if (!canSave) {
      list.replaceChildren(element('p', { className: 'hint', textContent: 'Templates can be saved once a Blob store is connected.' }));
      $('[data-template-save]').disabled = true;
      return;
    }
    try {
      const templates = await api('GET', '/api/admin/templates');
      $('[data-template-count]').textContent = `${templates.length} of ${schema.templateLimit}`;
      list.replaceChildren();
      if (!templates.length) list.append(element('p', { className: 'hint', textContent: 'No templates saved yet.' }));
      for (const template of templates) {
        const design = schema.designs.find((item) => item.id === template.design);
        const load = element('button', { type: 'button', className: 'secondary small', textContent: 'Load' });
        const overwrite = element('button', { type: 'button', className: 'secondary small', textContent: 'Save over' });
        const remove = element('button', { type: 'button', className: 'danger small', textContent: 'Delete' });
        load.addEventListener('click', () => loadTemplate(template));
        overwrite.addEventListener('click', () => saveTemplate(template.name, true));
        remove.addEventListener('click', () => deleteTemplate(template));
        list.append(
          element('div', { className: 'template' }, [
            swatches(template.colours),
            element('div', { className: 'template__info' }, [
              element('div', { className: 'template__name', textContent: template.name }),
              element('div', {
                className: 'template__meta',
                textContent: `${design ? design.name : template.design} · ${template.couple} · saved ${dateTime.format(new Date(template.savedAt))}`,
              }),
            ]),
            element('div', { className: 'template__actions' }, [load, overwrite, remove]),
          ]),
        );
      }
    } catch (error) {
      list.replaceChildren(element('p', { className: 'status is-error', textContent: error.message }));
    }
  }

  async function saveTemplate(name, replacing = false) {
    if (replacing && !confirm(`Replace the template “${name}” with what is in the editor now?`)) return;
    setStatus(templateStatus, 'Saving template…');
    try {
      const saved = await api('POST', '/api/admin/templates', { name, invitation: current });
      setStatus(templateStatus, `Saved as “${saved.name}”.`, 'ok');
      $('[data-template-name]').value = '';
      loadTemplates();
    } catch (error) {
      setStatus(templateStatus, error.message, 'error');
    }
  }

  async function loadTemplate(template) {
    if (dirty && !confirm('Loading a template replaces your unsaved changes in the editor. Continue?')) return;
    try {
      current = await api('GET', `/api/admin/templates/${encodeURIComponent(template.id)}`);
      buildForm();
      markDirty();
      setStatus(templateStatus, `Loaded “${template.name}”. Press Save changes to publish it.`, 'ok');
      setStatus($('[data-save-status]'), `“${template.name}” is loaded but not published yet.`);
    } catch (error) {
      setStatus(templateStatus, error.message, 'error');
    }
  }

  async function deleteTemplate(template) {
    if (!confirm(`Delete the template “${template.name}”? This cannot be undone.`)) return;
    try {
      await api('DELETE', `/api/admin/templates/${encodeURIComponent(template.id)}`);
      setStatus(templateStatus, `Deleted “${template.name}”.`, 'ok');
      loadTemplates();
    } catch (error) {
      setStatus(templateStatus, error.message, 'error');
    }
  }

  $('[data-template-save]').addEventListener('click', () => {
    const name = $('[data-template-name]').value.trim();
    if (!name) return setStatus(templateStatus, 'Give the template a name.', 'error');
    saveTemplate(name);
  });

  // ---- Wishes ----

  async function loadWishes() {
    const box = $('[data-wishes]');
    box.replaceChildren(element('p', { className: 'hint', textContent: 'Loading…' }));
    try {
      const wishes = await api('GET', '/api/admin/wishes');
      const pending = wishes.filter((wish) => wish.status === 'pending').length;
      const badge = $('[data-pending]');
      badge.hidden = !pending;
      badge.textContent = String(pending);
      box.replaceChildren();
      if (!wishes.length) box.append(element('p', { className: 'hint', textContent: 'No wishes yet.' }));
      const labels = { visible: 'Shown', pending: 'Waiting for approval', hidden: 'Hidden' };
      for (const wish of wishes) {
        const actions = [];
        if (wish.status !== 'visible') actions.push(['secondary', wish.status === 'pending' ? 'Approve' : 'Show', () => setWish(wish, 'visible')]);
        if (wish.status !== 'hidden') actions.push(['secondary', 'Hide', () => setWish(wish, 'hidden')]);
        actions.push(['danger', 'Delete', () => deleteWish(wish)]);
        box.append(
          element('article', { className: `wish${wish.status === 'hidden' ? ' wish--hidden' : ''}` }, [
            element('div', { className: 'wish__meta' }, [
              element('span', { className: 'wish__name', textContent: wish.name }),
              element('span', { className: `pill pill--${wish.status}`, textContent: labels[wish.status] }),
              element('span', { className: 'wish__date', textContent: `${dateTime.format(new Date(wish.createdAt))} · ${wish.likes} likes` }),
            ]),
            element('p', { className: 'wish__message', textContent: wish.message }),
            element(
              'div',
              { className: 'wish__actions' },
              actions.map(([style, text, onClick]) => {
                const button = element('button', { type: 'button', className: `${style} small`, textContent: text });
                button.addEventListener('click', onClick);
                return button;
              }),
            ),
          ]),
        );
      }
    } catch (error) {
      box.replaceChildren(element('p', { className: 'status is-error', textContent: error.message }));
    }
  }

  async function setWish(wish, status) {
    try {
      await api('PATCH', `/api/admin/wishes/${encodeURIComponent(wish.id)}`, { status });
    } catch (error) {
      alert(error.message);
    }
    loadWishes();
  }

  async function deleteWish(wish) {
    if (!confirm(`Delete the wish from ${wish.name}? This cannot be undone.`)) return;
    try {
      await api('DELETE', `/api/admin/wishes/${encodeURIComponent(wish.id)}`);
    } catch (error) {
      alert(error.message);
    }
    loadWishes();
  }

  // ---- Start ----

  document.querySelectorAll('[data-tab]').forEach((tab) =>
    tab.addEventListener('click', () => {
      show(tab.dataset.tab);
      if (tab.dataset.tab === 'wishes') loadWishes();
    }),
  );
  $('[data-refresh]').addEventListener('click', loadWishes);

  $('[data-logout]').addEventListener('click', async () => {
    if (dirty && !confirm('You have unsaved changes. Sign out anyway?')) return;
    await api('POST', '/api/admin/logout', {});
    dirty = false;
    location.reload();
  });

  $('[data-login]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = $('[data-login-status]');
    setStatus(status, 'Checking…');
    try {
      await api('POST', '/api/admin/login', { password: event.target.elements.password.value });
      event.target.reset();
      setStatus(status, '');
      start();
    } catch (error) {
      setStatus(status, error.message, 'error');
    }
  });

  async function start() {
    try {
      const session = await api('GET', '/api/admin/session');
      if (session.setupMessage) {
        $('[data-setup-message]').textContent = session.setupMessage;
        return show('setup');
      }
      if (!session.signedIn) return show('login');
      $('[data-logout]').hidden = !session.loginRequired;
      [schema, current] = await Promise.all([api('GET', '/api/admin/schema'), api('GET', '/api/admin/invitation')]);
      canSave = Boolean(session.storage);
      if (!canSave) {
        const notice = $('[data-storage-notice]');
        notice.hidden = false;
        notice.textContent =
          'This deployment has no Vercel Blob store, so saving, uploading photos and songs, templates and guest wishes are off. ' +
          'To turn them on: in Vercel open this project, go to Storage, create a Blob store with Public access and connect it to the project, ' +
          'then go to Deployments and Redeploy. Until then the invitation shows content/invitation.json; you can still try designs in the preview.';
        $('[data-save]').disabled = true;
      }
      buildForm();
      show('edit');
      renderPreview();
      loadTemplates();
      if (session.wishesAvailable) loadWishes();
    } catch (error) {
      $('[data-loading]').textContent = error.message;
    }
  }

  start();
})();
