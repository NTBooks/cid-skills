(function () {
    if (typeof window !== 'undefined') {
        if (window.__CLV_ALREADY_LOADED__) {
            try { console.log('[CLV] duplicate script include ignored'); } catch (_) { }
            return; // Prevent double-binding when script is included more than once
        }
        window.__CLV_ALREADY_LOADED__ = true;
    }
    var CLV_VERSION = 'clverify-2025-02-09-1';
    function log() {
        try {
            var parts = [];
            for (var i = 0; i < arguments.length; i++) {
                var a = arguments[i];
                if (typeof a === 'string') parts.push(a);
                else { try { parts.push(JSON.stringify(a)); } catch (_) { parts.push(String(a)); } }
            }
            console.log('[CLV]', parts.join(' '));
        } catch (_) { }
    }
    function ce(tag, cls) { var el = document.createElement(tag); if (cls) el.className = cls; return el; }
    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

    // Derive default host from the script tag that loaded this file
    var CLV_SCRIPT_HOST = (function () {
        try {
            var s = document.currentScript;
            if (!s) {
                var list = document.getElementsByTagName('script');
                for (var i = list.length - 1; i >= 0; i--) {
                    if ((list[i].src || '').indexOf('/clverify.js') !== -1) { s = list[i]; break; }
                }
            }
            if (s && s.src) { return new URL(s.src, location.href).host; }
        } catch (_) { }
        return location.host;
    })();
    log('Loaded', CLV_VERSION, 'scriptHost=', CLV_SCRIPT_HOST, 'readyState=', document.readyState, 'on', location.host);

    // Discover the <script> tag that loaded this file for global config via data-attributes
    var CLV_SCRIPT_TAG = (function () {
        try {
            var s = document.currentScript;
            if (!s) {
                var list = document.getElementsByTagName('script');
                for (var i = list.length - 1; i >= 0; i--) {
                    if ((list[i].src || '').indexOf('/clverify.js') !== -1) { s = list[i]; break; }
                }
            }
            return s || null;
        } catch (_) { return null; }
    })();

    // Configurable blockchain explorer base and optional suffix (e.g., #eventlog)
    var CLV_EXPLORER_TX_BASE = (function () {
        try {
            if (CLV_SCRIPT_TAG) {
                var v = CLV_SCRIPT_TAG.getAttribute('data-explorer')
                    || CLV_SCRIPT_TAG.getAttribute('data-explorer-tx')
                    || CLV_SCRIPT_TAG.getAttribute('data-explorerbase');
                if (v) { return v; }
            }
        } catch (_) { }
        return 'https://sepolia.basescan.org/tx/';
    })();
    var CLV_EXPLORER_TX_SUFFIX = (function () {
        try {
            if (CLV_SCRIPT_TAG) {
                if (CLV_SCRIPT_TAG.hasAttribute('data-explorersuffix')) {
                    return CLV_SCRIPT_TAG.getAttribute('data-explorersuffix');
                }
                if (CLV_SCRIPT_TAG.hasAttribute('data-explorer-suffix')) {
                    return CLV_SCRIPT_TAG.getAttribute('data-explorer-suffix');
                }
            }
        } catch (_) { }
        return '#eventlog';
    })();

    // Auto-inject CSS so host pages (e.g., WordPress) don't need to add a <link> tag
    (function ensureCssOnce() {
        try {
            var existing = document.querySelector('link[data-clverify-css="1"], link[href*="/clverify.css"]');
            if (existing) { log('CSS already present'); return; }
            var href = 'https://' + CLV_SCRIPT_HOST + '/widget/clverify.css?v=' + encodeURIComponent(CLV_VERSION);
            var link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            link.setAttribute('data-clverify-css', '1');
            (document.head || document.getElementsByTagName('head')[0] || document.documentElement).appendChild(link);
            log('Injected CSS', href);
        } catch (e) { log('Failed to inject CSS', e); }
    })();

    function scan(root) {
        try {
            var scope = root && root.querySelectorAll ? root : document;
            var btnTags = scope.querySelectorAll('clverify[cid]');
            var aTags = scope.querySelectorAll('a[cid]');
            log('scan() found', btnTags.length, '<clverify> tags and', aTags.length, '<a cid> tags');
            btnTags.forEach(function (el, idx) { try { log('binding clverify[' + idx + '] cid=' + el.getAttribute('cid')); render(el); } catch (e) { log('error binding clverify', e); } });
            aTags.forEach(function (el, idx) { try { if (el.getAttribute('data-clv-bound') === '1') return; log('binding anchor[' + idx + '] cid=' + el.getAttribute('cid')); renderAnchor(el); } catch (e) { log('error binding anchor', e); } });
        } catch (e) { log('scan error', e); }
    }

    function init() { scan(document); }

    function render(el) {
        var cid = el.getAttribute('cid');
        var privateSrc = el.getAttribute('privatesrc') || el.getAttribute('privateSrc') || '';
        var previewSrc = el.getAttribute('previewsrc') || '';
        log('render(): cid=' + cid + ' privateSrcPresent=' + (!!privateSrc) + ' privateSrc=' + (privateSrc || '-'));
        var gateway = (el.getAttribute('gateway') || 'https://chainletter.mypinata.cloud/ipfs/').replace(/\/$/, '/');
        var explorerBase = (el.getAttribute('explorer') || el.getAttribute('explorerbase') || CLV_EXPLORER_TX_BASE);
        var explorerSuffix = (el.getAttribute('explorersuffix') || el.getAttribute('explorer-suffix') || CLV_EXPLORER_TX_SUFFIX || '');
        // api attribute can be just a host (e.g., devedu.chainletter.io) or a full URL. We extract the host for nocors calls.
        var apiAttr = el.getAttribute('api') || '';
        var apiHost;
        if (!apiAttr) { apiHost = CLV_SCRIPT_HOST; }
        else if (/^https?:\/\//i.test(apiAttr)) { try { apiHost = new URL(apiAttr).host; } catch (_) { apiHost = CLV_SCRIPT_HOST; } }
        else if (/^[a-z0-9.-]+$/i.test(apiAttr)) { apiHost = apiAttr; }
        else { apiHost = CLV_SCRIPT_HOST; }
        var modeAttr = (el.getAttribute('mode') || 'auto').toLowerCase();
        var mode = modeAttr === 'auto'
            ? ((window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light')
            : modeAttr;
        var isGlobal = (el.getAttribute('global') || '').toLowerCase() === 'true';
        if (!cid) return;
        log('render() cid=', cid, 'apiHost=', apiHost, 'gateway=', gateway, 'mode=', mode, 'global=', isGlobal);

        var btn = ce('button', 'clv-btn ' + (mode === 'dark' ? 'clv-btn-dark' : 'clv-btn-light'));
        var glyphUrl = 'https://' + CLV_SCRIPT_HOST + '/widget/CL-Glyph-Icon.png';
        btn.innerHTML = '<img class="clv-icon" src="' + glyphUrl + '" alt="Chainletter" width="20" height="20" /> <span>Verify</span>';
        el.replaceWith(btn);

        var backdrop = ce('div', 'clv-backdrop');
        var shade = ce('div', 'clv-shade');
        var modal = ce('div', 'clv-modal');
        // Header with Chainletter wide logo and close button
        var header = ce('div', 'clv-header');
        var logo = ce('img'); var logoUrl = 'https://' + CLV_SCRIPT_HOST + '/widget/CL-Logo-White-Semitransparent-500.png'; logo.src = logoUrl; logo.alt = 'Chainletter'; logo.className = 'clv-logo';
        var closeHdr = ce('button', 'clv-close'); closeHdr.setAttribute('aria-label', 'Close'); closeHdr.innerHTML = '×';
        header.appendChild(logo); header.appendChild(closeHdr);
        var panel = ce('div', 'clv-panel');
        var left = ce('div', 'clv-left');
        var right = ce('div', 'clv-right');
        var title = ce('div', 'clv-title');
        var h = ce('h3'); h.textContent = 'Document Verification';
        title.appendChild(h);
        right.appendChild(title);

        var list = ce('div', 'clv-list');
        right.appendChild(list);

        var meta = ce('div', 'clv-meta'); right.appendChild(meta);
        var meaning = ce('div', 'clv-meaning'); right.appendChild(meaning);

        var actions = ce('div', 'clv-actions'); right.appendChild(actions);

        // Helper: status icon and row renderer
        function getStatusIconHtml(ok, context) {
            if (ok) {
                return '<svg width="20" height="20" viewBox="0 0 448 512" class="clv-pass" aria-hidden="true"><path fill="currentColor" d="M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z"/></svg>';
            }
            if (context === 'issued' || context === 'group') {
                return '<span class="clv-close clv-close-icon" aria-hidden="true">×</span>';
            }
            return '<span class="clv-icon-x" aria-hidden="true">×</span>';
        }

        function renderStatusRow(ok, labelText, link, opts) {
            var row = ce('div', 'clv-row');
            var context = opts && opts.context;

            var finalLabel = labelText;
            if (!ok && context === 'issued') {
                finalLabel = labelText.replace(/^Issued By/i, 'Not Issued By');
            } else if (!ok && context === 'group') {
                finalLabel = 'Not found in Group';
            }

            row.innerHTML = getStatusIconHtml(ok, context) + '<div></div>';
            var labelContainer = row.lastChild;

            if (opts && opts.labelElement) {
                labelContainer.appendChild(opts.labelElement);
            } else if (link && link.href) {
                var a = ce('a', 'clv-link');
                a.setAttribute('data-clv-link', '1');
                a.href = link.href;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.textContent = finalLabel;
                labelContainer.appendChild(a);
            } else {
                labelContainer.textContent = finalLabel;
            }

            list.appendChild(row);
            return row;
        }

        var heroWrap = ce('div', 'clv-hero-wrap');
        var hero = ce('div', 'clv-hero');
        heroWrap.appendChild(hero);
        left.appendChild(heroWrap);

        function activatePrivateMode() {
            try {
                if (!heroWrap.classList.contains('clv-private')) {
                    heroWrap.classList.add('clv-private');
                    left.classList.add('clv-private-mode');
                    var existing = heroWrap.querySelector('.clv-private-badge');
                    if (!existing) {
                        var badge = ce('div', 'clv-private-badge');
                        badge.textContent = 'Not publicly available';
                        heroWrap.appendChild(badge);
                    }
                }
            } catch (e) { }
        }

        // Drawer for group JSON
        var drawer = ce('div', 'clv-drawer');
        var dInner = ce('div', 'clv-drawer-inner');
        var dHeader = ce('div', 'clv-drawer-header');
        var dBack = ce('button', 'clv-drawer-back'); dBack.innerHTML = '← Back';
        var dTitle = ce('div', 'clv-drawer-title'); dTitle.textContent = 'Group File';
        dHeader.appendChild(dBack); dHeader.appendChild(dTitle);
        var dBody = ce('div', 'clv-drawer-body');
        var dPre = ce('pre', 'clv-pre'); dBody.appendChild(dPre);
        dInner.appendChild(dHeader); dInner.appendChild(dBody);
        drawer.appendChild(dInner);

        panel.appendChild(left); panel.appendChild(right); panel.appendChild(drawer);
        // Append in correct visual order: header → panel (no footer)
        modal.appendChild(header);
        modal.appendChild(panel);
        backdrop.appendChild(shade); backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        // Theme class: ensure exclusive application
        modal.classList.remove('clv-theme-light', 'clv-theme-dark');
        if (mode === 'light') { modal.classList.add('clv-theme-light'); }
        else { modal.classList.add('clv-theme-dark'); }

        function open() {
            backdrop.style.display = 'flex';
            // trigger fade-in
            requestAnimationFrame(function () { backdrop.classList.add('clv-show'); });
            document.body.__clv_prev = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            load();
        }
        function closeModal() {
            backdrop.classList.remove('clv-show');
            // delay hiding to allow fade-out
            setTimeout(function () { backdrop.style.display = 'none'; }, 220);
            document.body.style.overflow = document.body.__clv_prev || '';
        }

        btn.onclick = function () { log('button click open modal for cid=', cid); open(); };
        closeHdr.onclick = closeModal;
        shade.onclick = function (e) { if (e.target === shade) closeModal(); };
        document.addEventListener('keydown', function (e) { if (backdrop.style.display === 'flex' && e.key === 'Escape') closeModal(); });

        function passRow(ok, label, link) {
            return renderStatusRow(ok, label, link, {});
        }

        function previewAsImage(cid) {
            hero.innerHTML = '';
            if (previewSrc) { try { var pre = new Image(); pre.className = 'clv-preview'; pre.alt = 'Preview image'; pre.src = previewSrc; hero.appendChild(pre); } catch (_) { } }
            var img = new Image();
            img.alt = 'CID image';
            img.className = 'clv-hero-main';
            img.onload = function () { log('previewAsImage(): loaded IPFS image ' + (gateway + cid)); hero.appendChild(img); };
            img.onerror = function () {
                log('previewAsImage(): IPFS image failed ' + (gateway + cid));
                // Try privateSrc fallback if provided
                if (privateSrc) {
                    log('previewAsImage(): using privateSrc fallback ' + privateSrc);
                    activatePrivateMode();
                    img.src = privateSrc;
                } else {
                    if (previewSrc) {
                        log('previewAsImage(): no privateSrc and previewSrc present; keeping preview image');
                        // Do nothing: preview image already appended underneath
                    } else {
                        log('previewAsImage(): no privateSrc and no previewSrc; showing fallback text');
                        hero.innerHTML = '<div class="clv-fallback">No image preview available</div>';
                    }
                }
            };
            var tryUrl = gateway + cid;
            log('previewAsImage(): trying ' + tryUrl);
            img.src = tryUrl;
        }

        function load() {
            // Reset UI with skeletons
            list.innerHTML = ''; meta.innerHTML = ''; actions.innerHTML = '';
            hero.innerHTML = '';
            var heroSkel = ce('div', 'clv-skel clv-skel-hero'); hero.appendChild(heroSkel);
            var l1 = ce('div', 'clv-skel clv-skel-line'); l1.style.width = '75%'; list.appendChild(l1);
            var l2 = ce('div', 'clv-skel clv-skel-line'); l2.style.width = '65%'; l2.style.marginTop = '8px'; list.appendChild(l2);
            var l3 = ce('div', 'clv-skel clv-skel-line'); l3.style.width = '80%'; l3.style.marginTop = '8px'; list.appendChild(l3);
            var m1Sk = ce('div', 'clv-skel clv-skel-doubleline'); m1Sk.style.width = '75%'; m1Sk.style.marginTop = '12px'; meta.appendChild(m1Sk);
            var m2Sk = ce('div', 'clv-skel clv-skel-doubleline'); m2Sk.style.width = '65%'; m2Sk.style.marginTop = '8px'; meta.appendChild(m2Sk);
            var aSk = ce('div', 'clv-skel clv-skel-btnblock'); aSk.style.marginTop = '10px'; actions.appendChild(aSk);
            var meaningSk = ce('div', 'clv-skel clv-skel-meaning'); meaning.innerHTML = ''; meaning.appendChild(meaningSk);

            // 1) Determine file type first, then decide hero preview. Also capture localIssued for Issued By row.
            var reverseData = null;
            var reversePromise = (async function () {
                try {
                    // Reverse lookup should use the same host we verify against
                    var base = 'https://' + apiHost;
                    var rl = base + '/widget/lookup/' + encodeURIComponent(cid);
                    log('fetch lookup', rl);
                    var resp = await fetch(rl);
                    var json = await resp.json();
                    reverseData = json;
                    console.log('anonreverselookup/addon result for', cid, json);
                    var t = ((json && json.data && json.data[0] && json.data[0].type) || '').toLowerCase();
                    var imageTypes = { png: 1, jpg: 1, jpeg: 1, gif: 1, webp: 1, bmp: 1, svg: 1, avif: 1 };
                    var textTypes = { txt: 1, json: 1, csv: 1, md: 1, markdown: 1, log: 1 }; // extend as needed
                    var audioTypes = { mp3: 1, wav: 1, ogg: 1, m4a: 1 };
                    var videoTypes = { mp4: 1, webm: 1, ogv: 1, mov: 1 };
                    if (imageTypes[t]) {
                        previewAsImage(cid);
                    } else if (textTypes[t]) {
                        log('reverse(): detected text type ' + t + ', attempting text preview from IPFS');
                        // Load text content and show in scrollable panel
                        try {
                            var tr = await fetch(gateway + cid);
                            var text = await tr.text();
                            // Pretty print JSON
                            if (t === 'json') {
                                try {
                                    var obj = JSON.parse(text);
                                    var pretty = JSON.stringify(obj, null, 2);
                                    var escd = pretty.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                                    var html = escd
                                        .replace(/\"(.*?)\"\s*:/g, '<span class="j-key">"$1"</span>:')
                                        .replace(/:\s*\"([^\"]*)\"/g, ': <span class="j-string">"$1"</span>')
                                        .replace(/:\s*(\d+\.?\d*)/g, ': <span class="j-number">$1</span>')
                                        .replace(/:\s*(true|false)/g, ': <span class="j-boolean">$1</span>')
                                        .replace(/:\s*(null)/g, ': <span class="j-null">$1</span>');
                                    hero.innerHTML = '';
                                    var preJson = ce('pre', 'clv-textpre clv-json');
                                    preJson.innerHTML = html;
                                    hero.appendChild(preJson);
                                    return;
                                } catch (_) { }
                            }
                            // Lightweight markdown to HTML for md/markdown
                            if (t === 'md' || t === 'markdown') {
                                var html = text
                                    .replace(/&/g, '&amp;')
                                    .replace(/</g, '&lt;')
                                    .replace(/>/g, '&gt;');
                                // very minimal conversions
                                html = html
                                    .replace(/^###\s+(.*)$/gm, '<h3>$1</h3>')
                                    .replace(/^##\s+(.*)$/gm, '<h2>$1</h2>')
                                    .replace(/^#\s+(.*)$/gm, '<h1>$1</h1>')
                                    .replace(/^\s*[-*]\s+(.*)$/gm, '<li>$1</li>')
                                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                                    .replace(/\*(.*?)\*/g, '<em>$1</em>')
                                    .replace(/`([^`]+)`/g, '<code>$1</code>')
                                    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1<\/a>');
                                // wrap list items
                                html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1<\/ul>');
                                hero.innerHTML = '';
                                var div = ce('div', 'clv-md');
                                div.innerHTML = html
                                    .replace(/^(?!<h\d|<ul|<li|<pre|<code|<p)(.+)$/gm, '<p>$1</p>');
                                hero.appendChild(div);
                                return;
                            }
                            hero.innerHTML = '';
                            var pre = ce('pre', 'clv-textpre');
                            pre.textContent = text;
                            hero.appendChild(pre);
                        } catch (e2) {
                            log('reverse(): text preview failed from IPFS. privateSrcPresent=' + (!!privateSrc) + ' err=' + (e2 && (e2.message || e2.toString ? e2.toString() : 'error')));
                            hero.innerHTML = '<div class="clv-fallback">Preview unavailable</div>';
                        }
                    } else if (audioTypes[t]) {
                        log('reverse(): detected audio type ' + t + ', preview via <audio> from IPFS');
                        hero.innerHTML = '';
                        var audio = ce('audio');
                        audio.controls = true;
                        audio.src = gateway + cid;
                        audio.preload = 'metadata';
                        hero.appendChild(audio);
                    } else if (videoTypes[t]) {
                        log('reverse(): detected video type ' + t + ', preview via <video> from IPFS');
                        hero.innerHTML = '';
                        var video = ce('video');
                        video.controls = true;
                        video.src = gateway + cid;
                        video.preload = 'metadata';
                        hero.appendChild(video);
                    } else if (t === 'pdf') {
                        log('reverse(): detected pdf, preview via <iframe> from IPFS');
                        hero.innerHTML = '';
                        var ifr = ce('iframe');
                        ifr.src = gateway + cid + '#toolbar=1&navpanes=0';
                        hero.appendChild(ifr);
                    } else {
                        log('reverse(): unknown type ' + t + '; removing hero');
                        // Unknown file type: remove hero and hide actions; switch to single-column panel
                        left.remove();
                        panel.classList.add('clv-no-hero');
                        actions.style.display = 'none';
                        modal.classList.add('clv-compact');
                    }
                } catch (e) {
                    log('reverse(): error during type detection/fetch err=%o; fallback to previewAsImage', e);
                    // Fallback: attempt image preview as before
                    previewAsImage(cid);
                }
            })();

            // 2) Verify request on nocors endpoint using chosen host
            var url = 'https://' + apiHost + '/widget/verify?cid=' + encodeURIComponent(cid) + '&limit=1';
            log('fetch verify', url);
            fetch(url).then(r => r.json()).then(async function (summary) {
                var data = summary?.data || (summary?.chainLetterResult?.data) || {};
                h.textContent = data.filename || 'Document Verification';

                // Replace list skeletons
                list.innerHTML = '';
                // DB result
                passRow(!!summary.success, 'Chainletter Database');

                // Issued By and Group rows: skip when global=true (direct postmarks)
                if (!isGlobal) {
                    await reversePromise.catch(function () { });
                    (function () {
                        var d = summary?.data || summary?.chainLetterResult?.data || {};
                        var brand = reverseData && reverseData.personaBrand ? reverseData.personaBrand : null;
                        var brandUrl = reverseData && reverseData.plurl ? ('https://' + reverseData.plurl) : null;
                        var issuerName = (brand && brand.name) || d.issuer_name || location.hostname;
                        var brandLogo = (brand && (brand.logo_wide || brand.logo)) || null;
                        var issuerLogo = brandLogo ? ((/^https?:\/\//i.test(brandLogo) ? brandLogo : (gateway + brandLogo))) : (d.issuer_logo || null);
                        var ok = !!(reverseData && reverseData.localIssued);
                        if (ok && issuerLogo) {
                            var labelEl = ce('div');
                            if (brandUrl) {
                                labelEl.innerHTML = '<div class="clv-issuer"><a href="' + brandUrl + '" target="_blank" rel="noopener noreferrer"><img class="clv-issuer-logo" src="' + issuerLogo + '" alt="' + issuerName + '"/></a> <a href="' + brandUrl + '" target="_blank" rel="noopener noreferrer">Issued By ' + issuerName + '</a></div>';
                            } else {
                                labelEl.innerHTML = '<div class="clv-issuer"><img class="clv-issuer-logo" src="' + issuerLogo + '" alt="' + issuerName + '"/> Issued By ' + issuerName + '</div>';
                            }
                            renderStatusRow(true, 'Issued By ' + issuerName, null, { context: 'issued', labelElement: labelEl });
                        } else {
                            renderStatusRow(ok, 'Issued By ' + issuerName, null, { context: 'issued' });
                        }
                    })();

                    if (data.isBulk) {
                        var r = renderStatusRow(true, 'Stamped as Part of a Group', { href: '/ipfs/' + data.isBulk }, { context: 'group' });
                        var a = r.querySelector('a[data-clv-link="1"]');
                        if (a) {
                            a.addEventListener('click', function (ev) {
                                ev.preventDefault();
                                openDrawer(data.isBulk, cid);
                            });
                        }
                        var sub = ce('div', 'clv-sub'); sub.textContent = data.isBulk; r.appendChild(sub);
                    } else {
                        renderStatusRow(false, 'Stamped as Part of a Group', null, { context: 'group' });
                    }
                } else {
                    await reversePromise.catch(function () { });
                }

                // Base chain tx row (always show). Label depends on whether this is part of a group.
                (function () {
                    var chainOk = !!data.foreign_tx_id;
                    var chainLabel = data.isBulk ? 'Group Found on Base Blockchain' : 'File Found on Base Blockchain';
                    if (chainOk) {
                        passRow(true, chainLabel, { href: explorerBase + data.foreign_tx_id + (explorerSuffix || '') });
                    } else {
                        passRow(false, chainLabel);
                    }
                })();

                // IPFS availability HEAD check
                fetch(gateway + cid, { method: 'HEAD' }).then(function (r) {
                    log('HEAD IPFS check: status=' + (r && r.status) + ' ok=' + !!(r && r.status && r.status < 400));
                    passRow(r && r.status && r.status < 400, 'File Found on ChainLetter IPFS');
                }).catch(function (e) { log('HEAD IPFS check: error %o', e); passRow(false, 'File Found on ChainLetter IPFS'); });

                // Meta
                var created = data.created ? new Date(data.created * 1000).toLocaleString() : '-';
                meta.innerHTML = '';
                var m1 = ce('div'); m1.innerHTML = '<div class="lbl">First Time File Stamped</div><div class="val">' + created + '</div>';
                meta.appendChild(m1);

                // Compute meaning/summary
                try {
                    await reversePromise.catch(function () { });
                    var dbFound = !!summary.success;
                    var inGroup = !!data.isBulk;
                    var onChain = !!data.foreign_tx_id;
                    var onIpfs = false;
                    try {
                        var head = await fetch(gateway + cid, { method: 'HEAD' });
                        onIpfs = head && head.status && head.status < 400;
                    } catch (_) { }
                    var localIssued = !!(reverseData && reverseData.localIssued);

                    var level = 'unknown';
                    var blurb = 'Unknown file.';
                    if (isGlobal) {
                        if (dbFound && onChain && onIpfs) {
                            level = 'confirmed';
                            blurb = 'Fully verified: This file was found in the Chainletter database, on the Base blockchain, and on ChainLetter IPFS.';
                        } else if (dbFound || onChain || onIpfs) {
                            level = 'exists';
                            blurb = 'Exists but not fully verified: This file was found in some sources; full verification requires Chainletter database, Base blockchain, and IPFS.';
                        }
                    } else if (onChain) {
                        level = localIssued ? 'confirmed' : 'caution';
                        blurb = localIssued
                            ? 'Blockchain Confirmed: This file was stamped as part of a collection on the Base blockchain.'
                            : ('Blockchain Confirmed: This file was stamped as part of a collection on the Base blockchain <strong>but it was not issued by ' + esc(location.hostname) + '</strong>.');
                    } else if (dbFound || inGroup || onIpfs) {
                        level = 'exists';
                        blurb = 'Exists but not Confirmed: A Chainletter user registered this file and it may be part of a collection; awaiting blockchain confirmation.';
                    }

                    meaning.innerHTML = '';
                    var mTitle = ce('div', 'clv-meaning-title clv-fade-in'); mTitle.textContent = 'What this means';
                    var mRow = ce('div', 'clv-meaning-row clv-fade-in');
                    var stop = ce('div', 'clv-stoplight');
                    var l1 = ce('div', 'clv-light red' + ((level === 'unknown') ? ' lit' : ''));
                    l1.textContent = '1';
                    var l2 = ce('div', 'clv-light orange' + (level === 'caution' || level === 'exists' ? ' lit' : ''));
                    l2.textContent = '2';
                    var l3 = ce('div', 'clv-light green' + (level === 'confirmed' ? ' lit' : ''));
                    l3.textContent = '3';
                    stop.appendChild(l1); stop.appendChild(l2); stop.appendChild(l3);
                    var mText = ce('div', 'clv-meaning-text');
                    mText.innerHTML = blurb + (
                        onIpfs
                            ? ' The file is publicly available on IPFS.'
                            : (onChain
                                ? ' It was not found on IPFS; it is likely privately stamped and not posted online yet, or it may be pending upload.'
                                : '')
                    );
                    mRow.appendChild(stop); mRow.appendChild(mText);
                    meaning.appendChild(mTitle); meaning.appendChild(mRow);
                } catch (_) { meaning.innerHTML = ''; }

                // Actions
                actions.innerHTML = '';
                var a1 = ce('a', 'clv-ghost'); a1.href = gateway + cid; a1.target = '_blank'; a1.rel = 'noopener noreferrer'; a1.textContent = 'Open on IPFS';
                var a2 = ce('a', 'clv-ghost'); a2.href = 'https://' + apiHost + '/pverify/' + cid; a2.target = '_blank'; a2.rel = 'noopener noreferrer'; a2.textContent = 'Open Full Report';
                // Force tab behavior across browsers by delegating to window.open on click
                a2.addEventListener('click', function (e) {
                    e.preventDefault();
                    try { window.open(a2.href, '_blank', 'noopener'); }
                    catch (_) { location.href = a2.href; }
                });
                // Download Verifiable File (saves the IPFS content with best-guess extension)
                var a3 = ce('button', 'clv-ghost'); a3.type = 'button'; a3.textContent = 'Download Verifiable File';
                var forcePrivateDownload = false;
                var isPrivatePreview = false;
                a3.addEventListener('click', async function () {
                    try {
                        log('download(): clicked for cid=' + cid);
                        a3.disabled = true;
                        var ext = (reverseData && reverseData.data && reverseData.data[0] && reverseData.data[0].type) ? String(reverseData.data[0].type).toLowerCase() : '';
                        var name = data.filename || ('chainletter-' + cid.slice(0, 10));
                        // If no extension on name, append from ext; otherwise, ensure it matches
                        if (ext && !name.toLowerCase().endsWith('.' + ext)) {
                            name = name.replace(/[\.#]+$/, '');
                            name = name + '.' + ext;
                        }
                        // Fetch as blob then save
                        var usePrivate = !!forcePrivateDownload;
                        var resp;
                        if (!usePrivate) {
                            try {
                                resp = await fetch(gateway + cid, { method: 'HEAD' });
                                var okHead = resp && resp.status && resp.status < 400;
                                var ctHead = resp && resp.headers ? (resp.headers.get('Content-Type') || '') : '';
                                if (!okHead || /text\/html/i.test(ctHead)) { usePrivate = !!privateSrc; }
                            } catch (_) { usePrivate = !!privateSrc; }
                        }
                        if (usePrivate) {
                            log('download(): using privateSrc ' + privateSrc);
                            a3.classList.add('clv-danger'); a3.textContent = 'Download Private File';
                            resp = await fetch(privateSrc);
                        }
                        else {
                            resp = await fetch(gateway + cid);
                        }
                        var ct = resp.headers.get('Content-Type') || '';
                        log('download(): content-type=' + ct + ' ext(before)=' + ext);
                        if (!ext) {
                            if (/image\/png/i.test(ct)) ext = 'png';
                            else if (/image\/(jpeg|jpg)/i.test(ct)) ext = 'jpg';
                            else if (/image\/gif/i.test(ct)) ext = 'gif';
                            else if (/image\/webp/i.test(ct)) ext = 'webp';
                            else if (/image\/bmp/i.test(ct)) ext = 'bmp';
                            else if (/image\/svg\+xml/i.test(ct)) ext = 'svg';
                            else if (/application\/pdf/i.test(ct)) ext = 'pdf';
                            else if (/text\//i.test(ct)) ext = 'txt';
                            if (ext && !name.toLowerCase().endsWith('.' + ext)) name = name + '.' + ext;
                        }
                        log('download(): final filename=' + name);
                        var blob = await resp.blob();
                        var urlObj = URL.createObjectURL(blob);
                        var dl = ce('a'); dl.href = urlObj; dl.download = name; document.body.appendChild(dl); dl.click(); dl.remove();
                        setTimeout(function () { URL.revokeObjectURL(urlObj); a3.disabled = false; }, 250);
                    } catch (err) {
                        log('download(): error %o', err);
                        a3.disabled = false;
                        // Fallback: navigate to gateway resource (may still save from browser)
                        try { window.open(gateway + cid, '_blank', 'noopener'); } catch (_) { location.href = gateway + cid; }
                    }
                });
                // Hide IPFS actions if not on IPFS and no privateSrc provided
                (async function () {
                    var onIpfs = false;
                    try {
                        var head = await fetch(gateway + cid, { method: 'HEAD' });
                        var ct = head && head.headers ? (head.headers.get('Content-Type') || '') : '';
                        onIpfs = !!(head && head.status && head.status < 400 && !/text\/html/i.test(ct));
                        log('actions(): IPFS HEAD=' + (head && head.status) + ' ct=' + ct + ' onIpfs=' + onIpfs);
                    } catch (e) { log('actions(): IPFS HEAD error ' + (e && (e.message || e.toString ? e.toString() : 'error'))); }
                    var showPrivate = (!onIpfs && !!privateSrc) || isPrivatePreview;
                    if (!onIpfs && !privateSrc) {
                        log('actions(): not on IPFS and no privateSrc; showing only Full Report');
                        // Only show Full Report
                        actions.appendChild(a2);
                        return;
                    }
                    if (showPrivate) {
                        log('actions(): using private mode; enabling red download label and hiding Open on IPFS');
                        a3.classList.add('clv-danger'); a3.textContent = 'Download Private File';
                        forcePrivateDownload = true;
                        // Do not show Open on IPFS in private mode
                        actions.appendChild(a2);
                        actions.appendChild(a3);
                        return;
                    }
                    // On IPFS: show all buttons
                    actions.appendChild(a1);
                    actions.appendChild(a2);
                    actions.appendChild(a3);
                })();

            }).catch(function (err) {
                log('verify fetch error', err);
                h.textContent = 'Document Verification';
                passRow(false, 'Could not load verification data');
            });
        }

        function openDrawer(groupCid, highlightCid) {
            drawer.classList.add('open');
            dTitle.textContent = 'Group File: ' + groupCid;
            dPre.textContent = '';
            // Skeleton in drawer
            dBody.classList.add('clv-skel');
            var url = (gateway + groupCid + '?');
            fetch(url).then(r => r.text()).then(function (txt) {
                // Pretty print JSON if parseable; otherwise show raw text
                var safe;
                try {
                    var parsed = JSON.parse(txt);
                    safe = esc(JSON.stringify(parsed, null, 2));
                } catch (e) {
                    safe = txt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                }
                var regex = new RegExp('(' + highlightCid.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + ')', 'g');
                dPre.innerHTML = safe.replace(regex, '<span class="clv-highlight clv-highlight-flash">$1</span>');
                dBody.classList.remove('clv-skel');
                var first = dPre.querySelector('.clv-highlight');
                if (first) { first.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
            }).catch(function () { dBody.classList.remove('clv-skel'); dPre.textContent = 'Could not load group file.'; });

            function closeDrawer() { drawer.classList.remove('open'); }
            dBack.onclick = closeDrawer;
        }
    }

    // Anchor mode: do not replace content; clicking opens the same modal
    function renderAnchor(aEl) {
        var cid = aEl.getAttribute('cid');
        var privateSrc = aEl.getAttribute('privatesrc') || aEl.getAttribute('privateSrc') || '';
        var previewSrc = aEl.getAttribute('previewsrc') || '';
        if (!cid) return;
        log('renderAnchor(): cid=' + cid + ' privateSrcPresent=' + (!!privateSrc) + ' privateSrc=' + (privateSrc || '-'));
        // Skip if already processed
        if (aEl.getAttribute('data-clv-bound') === '1') return;
        aEl.setAttribute('data-clv-bound', '1');
        // If an href is present on these special anchors, remove it to avoid navigation
        if (aEl.hasAttribute('href')) aEl.removeAttribute('href');
        // Ensure pointer cursor like normal links
        aEl.style.cursor = 'pointer';
        aEl.setAttribute('role', 'link');
        // Optional inline logo/outline styling
        var wantLogo = aEl.hasAttribute('logo') && String(aEl.getAttribute('logo')).toLowerCase() !== 'false';
        if (wantLogo) {
            aEl.classList.add('clv-inline-link');
            // Prepend glyph icon if not already added
            var hasIcon = aEl.querySelector('img.clv-inline-icon');
            if (!hasIcon) {
                var icon = new Image();
                var glyphUrl = 'https://' + CLV_SCRIPT_HOST + '/widget/CL-Glyph-Icon.png';
                icon.src = glyphUrl;
                icon.alt = 'Chainletter';
                icon.className = 'clv-inline-icon';
                aEl.insertBefore(icon, aEl.firstChild);
            }
        }
        var gateway = (aEl.getAttribute('gateway') || 'https://chainletter.mypinata.cloud/ipfs/').replace(/\/$/, '/');
        var explorerBase = (aEl.getAttribute('explorer') || aEl.getAttribute('explorerbase') || CLV_EXPLORER_TX_BASE);
        var explorerSuffix = (aEl.getAttribute('explorersuffix') || aEl.getAttribute('explorer-suffix') || CLV_EXPLORER_TX_SUFFIX || '');
        var apiAttr = aEl.getAttribute('api') || '';
        var apiHost;
        if (!apiAttr) { apiHost = CLV_SCRIPT_HOST; }
        else if (/^https?:\/\//i.test(apiAttr)) { try { apiHost = new URL(apiAttr).host; } catch (_) { apiHost = CLV_SCRIPT_HOST; } }
        else if (/^[a-z0-9.-]+$/i.test(apiAttr)) { apiHost = apiAttr; }
        else { apiHost = CLV_SCRIPT_HOST; }
        var modeAttr = (aEl.getAttribute('mode') || 'auto').toLowerCase();
        var mode = modeAttr === 'auto'
            ? ((window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light')
            : modeAttr;
        var isGlobal = (aEl.getAttribute('global') || '').toLowerCase() === 'true';

        // Build modal elements (copied from render)
        var backdrop = ce('div', 'clv-backdrop');
        var shade = ce('div', 'clv-shade');
        var modal = ce('div', 'clv-modal');
        var header = ce('div', 'clv-header');
        var logo = ce('img'); var logoUrl = 'https://' + CLV_SCRIPT_HOST + '/widget/CL-Logo-White-Semitransparent-500.png'; logo.src = logoUrl; logo.alt = 'Chainletter'; logo.className = 'clv-logo';
        var closeHdr = ce('button', 'clv-close'); closeHdr.setAttribute('aria-label', 'Close'); closeHdr.innerHTML = '×';
        header.appendChild(logo); header.appendChild(closeHdr);
        var panel = ce('div', 'clv-panel');
        var left = ce('div', 'clv-left');
        var right = ce('div', 'clv-right');
        var title = ce('div', 'clv-title');
        var h = ce('h3'); h.textContent = 'Document Verification';
        title.appendChild(h);
        right.appendChild(title);
        var list = ce('div', 'clv-list'); right.appendChild(list);
        var meta = ce('div', 'clv-meta'); right.appendChild(meta);
        var meaning = ce('div', 'clv-meaning'); right.appendChild(meaning);
        var actions = ce('div', 'clv-actions'); right.appendChild(actions);
        var heroWrap = ce('div', 'clv-hero-wrap'); var hero = ce('div', 'clv-hero'); heroWrap.appendChild(hero); left.appendChild(heroWrap);
        var drawer = ce('div', 'clv-drawer'); var dInner = ce('div', 'clv-drawer-inner'); var dHeader = ce('div', 'clv-drawer-header'); var dBack = ce('button', 'clv-drawer-back'); dBack.innerHTML = '← Back'; var dTitle = ce('div', 'clv-drawer-title'); dTitle.textContent = 'Group File'; dHeader.appendChild(dBack); dHeader.appendChild(dTitle); var dBody = ce('div', 'clv-drawer-body'); var dPre = ce('pre', 'clv-pre'); dBody.appendChild(dPre); dInner.appendChild(dHeader); dInner.appendChild(dBody); drawer.appendChild(dInner);
        panel.appendChild(left); panel.appendChild(right); panel.appendChild(drawer);
        modal.appendChild(header); modal.appendChild(panel);
        backdrop.appendChild(shade); backdrop.appendChild(modal);

        // Theme
        modal.classList.remove('clv-theme-light', 'clv-theme-dark');
        if (mode === 'light') { modal.classList.add('clv-theme-light'); } else { modal.classList.add('clv-theme-dark'); }

        function open() {
            document.body.appendChild(backdrop);
            backdrop.style.display = 'flex';
            requestAnimationFrame(function () { backdrop.classList.add('clv-show'); });
            document.body.__clv_prev = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            load();
        }
        function closeModal() {
            backdrop.classList.remove('clv-show');
            setTimeout(function () { try { backdrop.remove(); } catch (_) { backdrop.style.display = 'none'; } }, 220);
            document.body.style.overflow = document.body.__clv_prev || '';
        }
        shade.onclick = function (e) { if (e.target === shade) closeModal(); };
        closeHdr.onclick = closeModal;
        document.addEventListener('keydown', function (e) { if (backdrop.style.display === 'flex' && e.key === 'Escape') closeModal(); });

        function previewAsImage(cid) {
            hero.innerHTML = '';
            if (previewSrc) { try { var pre = new Image(); pre.className = 'clv-preview'; pre.alt = 'Preview image'; pre.src = previewSrc; hero.appendChild(pre); } catch (_) { } }
            var img = new Image();
            img.alt = 'CID image';
            img.className = 'clv-hero-main';
            img.onload = function () { log('anchor.previewAsImage(): loaded IPFS image ' + (gateway + cid)); hero.appendChild(img); };
            img.onerror = function () {
                log('anchor.previewAsImage(): IPFS image failed ' + (gateway + cid));
                if (privateSrc) { log('anchor.previewAsImage(): using privateSrc ' + privateSrc); heroWrap.classList.add('clv-private'); left.classList.add('clv-private-mode'); var badge = ce('div', 'clv-private-badge'); badge.textContent = 'Not publicly available'; heroWrap.appendChild(badge); img.src = privateSrc; }
                else {
                    if (previewSrc) { log('anchor.previewAsImage(): no privateSrc; keeping preview image'); }
                    else { log('anchor.previewAsImage(): no privateSrc and no previewSrc; fallback text'); hero.innerHTML = '<div class="clv-fallback">No image preview available</div>'; }
                }
            };
            log('anchor.previewAsImage(): trying ' + (gateway + cid));
            img.src = gateway + cid;
        }

        function renderStatusRow(ok, labelText, link, opts) {
            var row = ce('div', 'clv-row');
            var context = opts && opts.context;
            var finalLabel = labelText;
            if (!ok && context === 'issued') finalLabel = labelText.replace(/^Issued By/i, 'Not Issued By');
            else if (!ok && context === 'group') finalLabel = 'Not found in Group';
            row.innerHTML = (ok
                ? '<svg width="20" height="20" viewBox="0 0 448 512" class="clv-pass" aria-hidden="true"><path fill="currentColor" d="M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z"/></svg>'
                : (context === 'issued' || context === 'group') ? '<span class="clv-close clv-close-icon" aria-hidden="true">×</span>' : '<span class="clv-icon-x" aria-hidden="true">×</span>')
                + '<div></div>';
            var labelContainer = row.lastChild;
            if (opts && opts.labelElement) labelContainer.appendChild(opts.labelElement);
            else if (link && link.href) {
                var a = ce('a', 'clv-link');
                a.setAttribute('data-clv-link', '1');
                a.href = link.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = finalLabel;
                labelContainer.appendChild(a);
            } else { labelContainer.textContent = finalLabel; }
            list.appendChild(row); return row;
        }

        function load() {
            list.innerHTML = ''; meta.innerHTML = ''; actions.innerHTML = ''; hero.innerHTML = '';
            var heroSkel = ce('div', 'clv-skel clv-skel-hero'); hero.appendChild(heroSkel);
            var l1 = ce('div', 'clv-skel clv-skel-line'); l1.style.width = '75%'; list.appendChild(l1);
            var l2 = ce('div', 'clv-skel clv-skel-line'); l2.style.width = '65%'; l2.style.marginTop = '8px'; list.appendChild(l2);
            var l3 = ce('div', 'clv-skel clv-skel-line'); l3.style.width = '80%'; l3.style.marginTop = '8px'; list.appendChild(l3);
            var m1Sk = ce('div', 'clv-skel clv-skel-line'); m1Sk.style.width = '55%'; m1Sk.style.marginTop = '12px'; meta.appendChild(m1Sk);
            var m2Sk = ce('div', 'clv-skel clv-skel-line'); m2Sk.style.width = '45%'; m2Sk.style.marginTop = '8px'; meta.appendChild(m2Sk);
            var aSk = ce('div', 'clv-skel clv-skel-pill'); aSk.style.marginTop = '10px'; actions.appendChild(aSk);
            var meaningSk = ce('div', 'clv-skel clv-skel-meaning'); meaning.innerHTML = ''; meaning.appendChild(meaningSk);

            var reverseData = null;
            var reversePromise = (async function () {
                try {
                    var base = 'https://' + apiHost;
                    var rl = base + '/widget/lookup/' + encodeURIComponent(cid);
                    var resp = await fetch(rl);
                    var json = await resp.json();
                    reverseData = json;
                    var t = ((json && json.data && json.data[0] && json.data[0].type) || '').toLowerCase();
                    var imageTypes = { png: 1, jpg: 1, jpeg: 1, gif: 1, webp: 1, bmp: 1, svg: 1, avif: 1 };
                    var textTypes = { txt: 1, json: 1, csv: 1, md: 1, markdown: 1, log: 1 };
                    var audioTypes = { mp3: 1, wav: 1, ogg: 1, m4a: 1 };
                    var videoTypes = { mp4: 1, webm: 1, ogv: 1, mov: 1 };
                    if (imageTypes[t]) { previewAsImage(cid); }
                    else if (textTypes[t]) {
                        try {
                            var tr = await fetch(gateway + cid); var text = await tr.text();
                            if (t === 'json') { try { var obj = JSON.parse(text); var pretty = JSON.stringify(obj, null, 2); var escd = pretty.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); var html = escd.replace(/\"(.*?)\"\s*:/g, '<span class="j-key">"$1"</span>:').replace(/:\s*\"([^\"]*)\"/g, ': <span class="j-string">"$1"</span>').replace(/:\s*(\d+\.?\d*)/g, ': <span class="j-number">$1</span>').replace(/:\s*(true|false)/g, ': <span class="j-boolean">$1</span>').replace(/:\s*(null)/g, ': <span class="j-null">$1</span>'); hero.innerHTML = ''; var preJson = ce('pre', 'clv-textpre clv-json'); preJson.innerHTML = html; hero.appendChild(preJson); return; } catch (_) { } }
                            if (t === 'md' || t === 'markdown') { var html2 = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); html2 = html2.replace(/^###\s+(.*)$/gm, '<h3>$1</h3>').replace(/^##\s+(.*)$/gm, '<h2>$1</h2>').replace(/^#\s+(.*)$/gm, '<h1>$1</h1>').replace(/^\s*[-*]\s+(.*)$/gm, '<li>$1</li>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1<\/a>'); html2 = html2.replace(/(<li>.*<\/li>)/gs, '<ul>$1<\/ul>'); hero.innerHTML = ''; var div = ce('div', 'clv-md'); div.innerHTML = html2.replace(/^(?!<h\d|<ul|<li|<pre|<code|<p)(.+)$/gm, '<p>$1</p>'); hero.appendChild(div); return; }
                            hero.innerHTML = ''; var pre = ce('pre', 'clv-textpre'); pre.textContent = text; hero.appendChild(pre);
                        } catch (_) { hero.innerHTML = '<div class="clv-fallback">Preview unavailable</div>'; }
                    } else if (audioTypes[t]) {
                        hero.innerHTML = ''; var audio = ce('audio'); audio.controls = true; audio.src = gateway + cid; audio.preload = 'metadata'; hero.appendChild(audio);
                    } else if (videoTypes[t]) {
                        hero.innerHTML = ''; var video = ce('video'); video.controls = true; video.src = gateway + cid; video.preload = 'metadata'; hero.appendChild(video);
                    } else if (t === 'pdf') {
                        hero.innerHTML = ''; var ifr = ce('iframe'); ifr.src = gateway + cid + '#toolbar=1&navpanes=0'; hero.appendChild(ifr);
                    } else { left.remove(); panel.classList.add('clv-no-hero'); actions.style.display = 'none'; modal.classList.add('clv-compact'); }
                } catch (_) { previewAsImage(cid); }
            })();

            var url = 'https://' + apiHost + '/widget/verify?cid=' + encodeURIComponent(cid) + '&limit=1';
            fetch(url).then(r => r.json()).then(async function (summary) {
                var data = summary?.data || (summary?.chainLetterResult?.data) || {};
                h.textContent = data.filename || 'Document Verification';
                list.innerHTML = '';
                (function () { var ok = !!summary.success; var row = ce('div', 'clv-row'); row.innerHTML = (ok ? '<svg width="20" height="20" viewBox="0 0 448 512" class="clv-pass" aria-hidden="true"><path fill="currentColor" d="M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z"/></svg>' : '<span class="clv-icon-x" aria-hidden="true">×</span>') + '<div>Chainletter Database</div>'; list.appendChild(row); })();

                if (!isGlobal) {
                    await reversePromise.catch(function () { });
                    (function () {
                        var brand = reverseData && reverseData.personaBrand ? reverseData.personaBrand : null;
                        var brandUrl = reverseData && reverseData.plurl ? ('https://' + reverseData.plurl) : null;
                        var issuerName = (brand && brand.name) || location.hostname;
                        var brandLogo = (brand && (brand.logo_wide || brand.logo)) || null;
                        var issuerLogo = brandLogo ? ((/^https?:\/\//i.test(brandLogo) ? brandLogo : (gateway + brandLogo))) : null;
                        var ok = !!(reverseData && reverseData.localIssued);
                        if (ok && issuerLogo) {
                            var labelEl = ce('div');
                            if (brandUrl) { labelEl.innerHTML = '<div class="clv-issuer"><a href="' + brandUrl + '" target="_blank" rel="noopener noreferrer"><img class="clv-issuer-logo" src="' + issuerLogo + '" alt="' + issuerName + '"/></a> <a href="' + brandUrl + '" target="_blank" rel="noopener noreferrer">Issued By ' + issuerName + '</a></div>'; }
                            else { labelEl.innerHTML = '<div class="clv-issuer"><img class="clv-issuer-logo" src="' + issuerLogo + '" alt="' + issuerName + '"/> Issued By ' + issuerName + '</div>'; }
                            renderStatusRow(true, 'Issued By ' + issuerName, null, { context: 'issued', labelElement: labelEl });
                        } else { renderStatusRow(false, 'Issued By ' + issuerName, null, { context: 'issued' }); }
                    })();

                    if (data.isBulk) {
                        var r = renderStatusRow(true, 'Stamped as Part of a Group', { href: '/ipfs/' + data.isBulk }, { context: 'group' });
                        var a = r.querySelector('a[data-clv-link="1"]'); if (a) { a.addEventListener('click', function (ev) { ev.preventDefault(); openDrawer(data.isBulk, cid); }); }
                        var sub = ce('div', 'clv-sub'); sub.textContent = data.isBulk; r.appendChild(sub);
                    } else { renderStatusRow(false, 'Stamped as Part of a Group', null, { context: 'group' }); }
                } else {
                    await reversePromise.catch(function () { });
                }

                // Base chain tx row (always show). Label depends on whether this is part of a group.
                (function () {
                    var chainOk = !!data.foreign_tx_id;
                    var chainLabel = data.isBulk ? 'Group Found on Base Blockchain' : 'File Found on Base Blockchain';
                    if (chainOk) { renderStatusRow(true, chainLabel, { href: explorerBase + data.foreign_tx_id + (explorerSuffix || '') }, {}); }
                    else { renderStatusRow(false, chainLabel, null, {}); }
                })();

                try { var head = await fetch(gateway + cid, { method: 'HEAD' }); var okHead = head && head.status && head.status < 400; renderStatusRow(okHead, 'File Found on ChainLetter IPFS'); } catch (_) { renderStatusRow(false, 'File Found on ChainLetter IPFS'); }

                // Meta
                var created = data.created ? new Date(data.created * 1000).toLocaleString() : '-';
                meta.innerHTML = '';
                var m1 = ce('div'); m1.innerHTML = '<div class="lbl">First Time File Stamped</div><div class="val">' + created + '</div>';
                meta.appendChild(m1);

                // Meaning
                try {
                    await reversePromise.catch(function () { });
                    var dbFound = !!summary.success;
                    var inGroup = !!data.isBulk;
                    var onChain = !!data.foreign_tx_id;
                    var onIpfs = false;
                    try { var head2 = await fetch(gateway + cid, { method: 'HEAD' }); onIpfs = head2 && head2.status && head2.status < 400; } catch (_) { }
                    var localIssued = !!(reverseData && reverseData.localIssued);
                    var level = 'unknown'; var blurb = 'Unknown file.';
                    if (isGlobal) {
                        if (dbFound && onChain && onIpfs) { level = 'confirmed'; blurb = 'Fully verified: This file was found in the Chainletter database, on the Base blockchain, and on ChainLetter IPFS.'; }
                        else if (dbFound || onChain || onIpfs) { level = 'exists'; blurb = 'Exists but not fully verified: This file was found in some sources; full verification requires Chainletter database, Base blockchain, and IPFS.'; }
                    } else if (onChain) { level = localIssued ? 'confirmed' : 'caution'; blurb = localIssued ? 'Blockchain Confirmed: This file was stamped as part of a collection on the Base blockchain.' : ('Blockchain Confirmed: This file was stamped as part of a collection on the Base blockchain <strong>but it was not issued by ' + esc(location.hostname) + '</strong>.'); }
                    else if (dbFound || inGroup || onIpfs) { level = 'exists'; blurb = 'Exists but not Confirmed: A Chainletter user registered this file and it may be part of a collection; awaiting blockchain confirmation.'; }
                    meaning.innerHTML = '';
                    var mTitle = ce('div', 'clv-meaning-title clv-fade-in'); mTitle.textContent = 'What this means';
                    var mRow = ce('div', 'clv-meaning-row clv-fade-in');
                    var stop = ce('div', 'clv-stoplight');
                    var l1 = ce('div', 'clv-light red' + ((level === 'unknown') ? ' lit' : '')); l1.textContent = '1';
                    var l2 = ce('div', 'clv-light orange' + (level === 'caution' || level === 'exists' ? ' lit' : '')); l2.textContent = '2';
                    var l3 = ce('div', 'clv-light green' + (level === 'confirmed' ? ' lit' : '')); l3.textContent = '3';
                    stop.appendChild(l1); stop.appendChild(l2); stop.appendChild(l3);
                    var mText = ce('div', 'clv-meaning-text');
                    mText.innerHTML = blurb + (
                        onIpfs
                            ? ' The file is publicly available on IPFS.'
                            : (onChain
                                ? ' It was not found on IPFS; it is likely privately stamped and not posted online yet, or it may be pending upload.'
                                : '')
                    );
                    mRow.appendChild(stop); mRow.appendChild(mText);
                    meaning.appendChild(mTitle); meaning.appendChild(mRow);
                } catch (_) { meaning.innerHTML = ''; }

                // Actions
                actions.innerHTML = '';
                var a1 = ce('a', 'clv-ghost'); a1.href = gateway + cid; a1.target = '_blank'; a1.rel = 'noopener noreferrer'; a1.textContent = 'Open on IPFS';
                var a2 = ce('a', 'clv-ghost'); a2.href = 'https://' + apiHost + '/pverify/' + cid; a2.target = '_blank'; a2.rel = 'noopener noreferrer'; a2.textContent = 'Open Full Report';
                a2.addEventListener('click', function (e) { e.preventDefault(); try { window.open(a2.href, '_blank', 'noopener'); } catch (_) { location.href = a2.href; } });
                var a3 = ce('button', 'clv-ghost'); a3.type = 'button'; a3.textContent = 'Download Verifiable File';
                a3.addEventListener('click', async function () {
                    try {
                        a3.disabled = true;
                        var ext = (reverseData && reverseData.data && reverseData.data[0] && reverseData.data[0].type) ? String(reverseData.data[0].type).toLowerCase() : '';
                        var name = (data.filename || ('chainletter-' + cid.slice(0, 10)));
                        if (ext && !name.toLowerCase().endsWith('.' + ext)) { name = name.replace(/[\.#]+$/, ''); name = name + '.' + ext; }
                        var usePrivate = false; var resp;
                        try {
                            var head = await fetch(gateway + cid, { method: 'HEAD' });
                            var okHead = head && head.status && head.status < 400;
                            var ctHead = head && head.headers ? (head.headers.get('Content-Type') || '') : '';
                            usePrivate = !okHead || /text\/html/i.test(ctHead);
                        } catch (_) { usePrivate = true; }
                        if (usePrivate && privateSrc) { a3.classList.add('clv-danger'); a3.textContent = 'Download Private File'; resp = await fetch(privateSrc); }
                        else { resp = await fetch(gateway + cid); }
                        var ct = resp.headers.get('Content-Type') || '';
                        if (!ext) {
                            if (/image\/png/i.test(ct)) ext = 'png';
                            else if (/image\/(jpeg|jpg)/i.test(ct)) ext = 'jpg';
                            else if (/image\/gif/i.test(ct)) ext = 'gif';
                            else if (/image\/webp/i.test(ct)) ext = 'webp';
                            else if (/image\/bmp/i.test(ct)) ext = 'bmp';
                            else if (/image\/svg\+xml/i.test(ct)) ext = 'svg';
                            else if (/application\/pdf/i.test(ct)) ext = 'pdf';
                            else if (/text\//i.test(ct)) ext = 'txt';
                            if (ext && !name.toLowerCase().endsWith('.' + ext)) name = name + '.' + ext;
                        }
                        var blob = await resp.blob();
                        var urlObj = URL.createObjectURL(blob);
                        var dl = ce('a'); dl.href = urlObj; dl.download = name; document.body.appendChild(dl); dl.click(); dl.remove();
                        setTimeout(function () { URL.revokeObjectURL(urlObj); a3.disabled = false; }, 250);
                    } catch (err) {
                        a3.disabled = false;
                        try { window.open(gateway + cid, '_blank', 'noopener'); } catch (_) { location.href = gateway + cid; }
                    }
                });
                (async function () {
                    var onIpfs = false; try { var head = await fetch(gateway + cid, { method: 'HEAD' }); var ct = head && head.headers ? (head.headers.get('Content-Type') || '') : ''; onIpfs = !!(head && head.status && head.status < 400 && !/text\/html/i.test(ct)); log('anchor.actions(): IPFS HEAD=' + (head && head.status) + ' ct=' + ct + ' onIpfs=' + onIpfs); } catch (e) { log('anchor.actions(): IPFS HEAD error ' + (e && (e.message || e.toString ? e.toString() : 'error'))); }
                    var showPrivate = !onIpfs && !!privateSrc; if (!onIpfs && !privateSrc) { actions.appendChild(a2); return; }
                    if (showPrivate) { a3.classList.add('clv-danger'); a3.textContent = 'Download Private File'; actions.appendChild(a2); actions.appendChild(a3); return; }
                    actions.appendChild(a1); actions.appendChild(a2); actions.appendChild(a3);
                })();
            }).catch(function () { h.textContent = 'Document Verification'; renderStatusRow(false, 'Could not load verification data'); });
        }

        function openDrawer(groupCid, highlightCid) {
            drawer.classList.add('open');
            dTitle.textContent = 'Group File: ' + groupCid;
            dPre.textContent = '';
            dBody.classList.add('clv-skel');
            var url = (gateway + groupCid + '?');
            fetch(url).then(r => r.text()).then(function (txt) {
                var safe; try { var parsed = JSON.parse(txt); safe = esc(JSON.stringify(parsed, null, 2)); } catch (e) { safe = txt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
                var regex = new RegExp('(' + highlightCid.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + ')', 'g');
                dPre.innerHTML = safe.replace(regex, '<span class="clv-highlight clv-highlight-flash">$1</span>');
                dBody.classList.remove('clv-skel');
                var first = dPre.querySelector('.clv-highlight'); if (first) { first.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
            }).catch(function () { dBody.classList.remove('clv-skel'); dPre.textContent = 'Could not load group file.'; });
            function closeDrawer() { drawer.classList.remove('open'); }
            dBack.onclick = closeDrawer;
        }

        aEl.addEventListener('click', function (e) { e.preventDefault(); log('anchor click open modal for cid=', cid); open(); });
    }

    if (document.readyState !== 'loading') init(); else document.addEventListener('DOMContentLoaded', init);

    // Expose an imperative scan hook for dynamically inserted content
    try {
        if (typeof window !== 'undefined') {
            window.CLVerify = window.CLVerify || {};
            window.CLVerify.scan = scan;
            window.CLVerify.render = render;
            window.CLVerify.renderAnchor = renderAnchor;
            window.CLVerify.version = CLV_VERSION;
            // Allow runtime override of explorer links
            window.CLVerify.setExplorer = function (base, suffix) {
                try {
                    if (typeof base === 'string' && base) { CLV_EXPLORER_TX_BASE = base; }
                    if (typeof suffix === 'string') { CLV_EXPLORER_TX_SUFFIX = suffix; }
                    log('setExplorer(): base=', CLV_EXPLORER_TX_BASE, 'suffix=', CLV_EXPLORER_TX_SUFFIX);
                } catch (_) { }
            };
        }
    } catch (_) { }
})();


