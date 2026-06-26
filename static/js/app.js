// ========== COMMENTS TOGGLE ==========
function toggleComments(postId) {
    var el = document.getElementById('comments-' + postId);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

// ========== USER SEARCH ==========
var searchTimeout = null;
function searchUsers(query) {
    clearTimeout(searchTimeout);
    var container = document.getElementById('searchResults');
    if (!container) return;
    if (query.length < 2) { container.classList.remove('active'); return; }
    searchTimeout = setTimeout(function() {
        fetch('/api/rechercher_utilisateurs?q=' + encodeURIComponent(query))
            .then(function(r) { return r.json(); })
            .then(function(users) {
                container.innerHTML = '';
                if (users.length === 0) {
                    container.innerHTML = '<div class="search-result-item">Aucun résultat</div>';
                } else {
                    users.forEach(function(u) {
                        var div = document.createElement('div');
                        div.className = 'search-result-item';
                        div.innerHTML = '<div class="avatar-sm">' + u.prenom[0] + u.nom[0] + '</div><div><strong>' + u.prenom + ' ' + u.nom + '</strong><br><small>' + (u.filiere || '') + (u.universite ? ' · ' + u.universite : '') + '</small></div>';
                        div.onclick = function() { window.location = '/profil/' + u.id; };
                        container.appendChild(div);
                    });
                }
                container.classList.add('active');
            });
    }, 300);
}

document.addEventListener('click', function(e) {
    var sr = document.getElementById('searchResults');
    if (sr && !e.target.closest('.nav-search')) sr.classList.remove('active');
});

// ========== AUTO-DISMISS FLASH MESSAGES ==========
document.addEventListener('DOMContentLoaded', function() {
    var flashes = document.querySelectorAll('.flash');
    flashes.forEach(function(f) {
        setTimeout(function() {
            f.style.transition = 'opacity 0.4s';
            f.style.opacity = '0';
            setTimeout(function() { f.remove(); }, 400);
        }, 4000);
    });
});

// ========== DELETE CONFIRMATION ==========
document.addEventListener('click', function(e) {
    var del = e.target.closest('.btn-delete, .delete-post');
    if (del && !confirm('Supprimer définitivement ?')) {
        e.preventDefault();
    }
});

// ========== SCROLL TO TOP ==========
(function() {
    var btn = document.createElement('button');
    btn.innerHTML = '↑';
    btn.style.cssText = 'position:fixed;bottom:2rem;right:2rem;width:44px;height:44px;border-radius:50%;border:none;background:var(--orange-grad);color:white;font-size:1.25rem;cursor:pointer;box-shadow:0 4px 16px rgba(255,107,53,0.3);display:none;z-index:999;transition:transform 0.2s;';
    btn.onmouseenter = function() { btn.style.transform = 'scale(1.1)'; };
    btn.onmouseleave = function() { btn.style.transform = 'scale(1)'; };
    btn.onclick = function() { window.scrollTo({top:0,behavior:'smooth'}); };
    document.body.appendChild(btn);
    window.addEventListener('scroll', function() {
        btn.style.display = window.scrollY > 400 ? 'block' : 'none';
    });
})();

// ========== NOTIFICATION COUNTER ==========
function checkNotifications() {
    var badge = document.getElementById('notif-count');
    if (!badge) return;
    fetch('/api/notifications/non_lu')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.nb > 0) {
                badge.textContent = data.nb > 99 ? '99+' : data.nb;
                badge.style.display = 'inline';
            } else {
                badge.style.display = 'none';
            }
        }).catch(function() {});
}
checkNotifications();
setInterval(checkNotifications, 30000);
