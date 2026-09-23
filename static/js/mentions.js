// Echappe le texte avant de l'inserer en HTML (les noms viennent des utilisateurs)
function echapperHtml(texte) {
    return String(texte == null ? '' : texte).replace(/[&<>"']/g, function(c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

// Mention autocomplete
document.addEventListener('input', function(e) {
    if (!e.target.matches('.mention-input')) return;
    var textarea = e.target;
    var pos = textarea.selectionStart;
    var text = textarea.value;
    var before = text.substring(0, pos);
    var atIndex = before.lastIndexOf('@');
    if (atIndex === -1 || before.substring(atIndex).includes(' ')) {
        var dd = document.getElementById('mentionDropdown');
        if (dd) dd.style.display = 'none';
        return;
    }
    var query = before.substring(atIndex + 1);
    if (query.length < 1) { var dd = document.getElementById('mentionDropdown'); if (dd) dd.style.display = 'none'; return; }
    fetch('/api/mentions?q=' + encodeURIComponent(query))
        .then(function(r) { return r.json(); })
        .then(function(users) {
            var dd = document.getElementById('mentionDropdown');
            if (!dd) return;
            if (users.length === 0) { dd.style.display = 'none'; return; }
            dd.innerHTML = '';
            users.forEach(function(u) {
                var item = document.createElement('div');
                item.className = 'mention-item';
                item.innerHTML = '<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:#FF6B35;color:white;font-weight:700;font-size:0.75rem;flex-shrink:0;">' + echapperHtml((u.prenom || '?')[0] + (u.nom || '?')[0]) + '</span> <span><strong>' + echapperHtml(u.prenom + ' ' + u.nom) + '</strong> <small style="color:#999;">' + echapperHtml(u.filiere || '') + '</small></span>';
                item.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;transition:background 0.15s;';
                item.onmouseenter = function() { this.style.background = '#FFF0E8'; };
                item.onmouseleave = function() { this.style.background = ''; };
                item.onclick = function() {
                    var before = textarea.value.substring(0, atIndex);
                    var after = textarea.value.substring(pos);
                    textarea.value = before + '@' + u.prenom.toLowerCase() + '.' + u.nom.toLowerCase() + ' ' + after;
                    dd.style.display = 'none';
                    textarea.focus();
                    var newPos = before.length + u.prenom.length + u.nom.length + 3;
                    textarea.setSelectionRange(newPos, newPos);
                };
                dd.appendChild(item);
            });
            var rect = textarea.getBoundingClientRect();
            dd.style.display = 'block';
            dd.style.left = (rect.left + window.scrollX + 10) + 'px';
            dd.style.top = (rect.top + window.scrollY - dd.offsetHeight - 4) + 'px';
            dd.style.width = '280px';
        });
});

document.addEventListener('click', function(e) {
    if (!e.target.closest('.mention-input') && !e.target.closest('.mention-dropdown')) {
        var dd = document.getElementById('mentionDropdown');
        if (dd) dd.style.display = 'none';
    }
});

// Mention styles
var style = document.createElement('style');
style.textContent = '.mention { color: #FF6B35; font-weight: 600; text-decoration: none; } .mention:hover { text-decoration: underline; } .mention-item:hover { background: #FFF0E8; }';
document.head.appendChild(style);
