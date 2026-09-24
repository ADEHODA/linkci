// Dark Mode Toggle
const themeToggle = document.createElement('button');
themeToggle.className = 'theme-toggle';
themeToggle.innerHTML = '🌙';
themeToggle.setAttribute('aria-label', 'Toggle dark mode');
document.body.appendChild(themeToggle);

// Check for saved theme preference or default to light
const savedTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);
updateToggleIcon(savedTheme);

themeToggle.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateToggleIcon(newTheme);
    
    // Add animation
    themeToggle.style.transform = 'scale(0.8) rotate(180deg)';
    setTimeout(() => {
        themeToggle.style.transform = '';
    }, 300);
});

function updateToggleIcon(theme) {
    themeToggle.innerHTML = theme === 'dark' ? '☀️' : '🌙';
}

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Add loading animation to cards
document.querySelectorAll('.card').forEach((card, index) => {
    card.style.animationDelay = `${index * 50}ms`;
});

// Like button animation
document.querySelectorAll('.like-form').forEach(form => {
    form.addEventListener('submit', function(e) {
        const btn = this.querySelector('button');
        btn.style.transform = 'scale(1.3)';
        setTimeout(() => {
            btn.style.transform = '';
        }, 200);
    });
});

// Notification badge pulse
const notifBadge = document.querySelector('#notif-count');
if (notifBadge && notifBadge.textContent > 0) {
    notifBadge.style.animation = 'pulse 2s infinite';
}

// Message input enter to send
const messageInput = document.querySelector('.message-input-form input');
if (messageInput) {
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const form = messageInput.closest('form');
            if (form) form.submit();
        }
    });
}

// Search input focus effect
const searchInput = document.querySelector('.nav-search input');
if (searchInput) {
    searchInput.addEventListener('focus', function() {
        this.parentElement.style.transform = 'scale(1.02)';
    });
    searchInput.addEventListener('blur', function() {
        this.parentElement.style.transform = '';
    });
}

// Post content expand on hover
document.querySelectorAll('.post-content').forEach(content => {
    if (content.scrollHeight > 150) {
        content.style.maxHeight = '150px';
        content.style.overflow = 'hidden';
        content.style.cursor = 'pointer';
        
        content.addEventListener('click', function() {
            if (this.style.maxHeight === '150px') {
                this.style.maxHeight = 'none';
            } else {
                this.style.maxHeight = '150px';
            }
        });
    }
});

// Bourse card hover effect
document.querySelectorAll('.bourse-card').forEach(card => {
    card.addEventListener('mouseenter', function() {
        this.style.transform = 'translateY(-4px) scale(1.01)';
    });
    card.addEventListener('mouseleave', function() {
        this.style.transform = '';
    });
});

// Formation card hover effect
document.querySelectorAll('.formation-card').forEach(card => {
    card.addEventListener('mouseenter', function() {
        const badge = this.querySelector('.formation-badge');
        if (badge) {
            badge.style.transform = 'scale(1.1)';
            badge.style.transition = 'transform 0.3s ease';
        }
    });
    card.addEventListener('mouseleave', function() {
        const badge = this.querySelector('.formation-badge');
        if (badge) {
            badge.style.transform = '';
        }
    });
});

// Document card download button effect
document.querySelectorAll('.doc-card').forEach(card => {
    const downloadBtn = card.querySelector('a[href*="telecharger"]');
    if (downloadBtn) {
        downloadBtn.addEventListener('mouseenter', function() {
            this.style.transform = 'scale(1.05)';
        });
        downloadBtn.addEventListener('mouseleave', function() {
            this.style.transform = '';
        });
    }
});

// Smooth page transitions
document.addEventListener('DOMContentLoaded', () => {
    document.body.style.opacity = '0';
    document.body.style.transition = 'opacity 0.3s ease';
    setTimeout(() => {
        document.body.style.opacity = '1';
    }, 10);
});

// Add ripple effect to all buttons
document.querySelectorAll('.btn').forEach(button => {
    button.addEventListener('click', function(e) {
        const rect = this.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const ripple = document.createElement('span');
        ripple.style.cssText = `
            position: absolute;
            background: rgba(255,255,255,0.3);
            border-radius: 50%;
            transform: scale(0);
            animation: ripple 0.6s linear;
            pointer-events: none;
        `;
        ripple.style.left = x + 'px';
        ripple.style.top = y + 'px';
        
        this.appendChild(ripple);
        
        setTimeout(() => ripple.remove(), 600);
    });
});

// Add ripple animation keyframe
const style = document.createElement('style');
style.textContent = `
    @keyframes ripple {
        to {
            transform: scale(4);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Smooth counter animation for stats
function animateCounter(element, target) {
    let current = 0;
    const increment = target / 50;
    const timer = setInterval(() => {
        current += increment;
        if (current >= target) {
            element.textContent = target;
            clearInterval(timer);
        } else {
            element.textContent = Math.floor(current);
        }
    }, 20);
}

// Browser push notifications
function requestNotifPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}
function showNotif(title, body, url) {
    if ('Notification' in window && Notification.permission === 'granted') {
        const n = new Notification(title, { body: body, icon: '/static/images/favicon.svg' });
        if (url) {
            n.onclick = function() { window.focus(); window.location.href = url; };
        }
    }
}
document.addEventListener('DOMContentLoaded', requestNotifPermission);
// Listen for SocketIO notification_update events
document.addEventListener('DOMContentLoaded', function() {
    // Socket.IO n'est charge que sur certaines pages (connexion, admin... n'en ont pas)
    if (typeof io === 'undefined') return;
    const socket = io();
    socket.on('connect', function() { socket.emit('join_notifications'); });
    socket.on('notification_update', function(data) {
        showNotif('LINK CI', 'Nouvelle notification !', '/notifications');
    });
});

// Animate stats on page load
document.querySelectorAll('.stat-number').forEach(stat => {
    const target = parseInt(stat.textContent);
    if (!isNaN(target)) {
        stat.textContent = '0';
        setTimeout(() => animateCounter(stat, target), 500);
    }
});

// Add hover sound effect (optional - can be enabled)
// Uncomment below to enable
/*
const hoverSound = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVggoKOe2FcZ3OAkZ+Lb2Bfbn2RnItxYV1ufZGci3FhXW59kZyLcWFdbn2RnItxYV1ufZGci3FhXW59kZyLcWFdbn2RnA==');
document.querySelectorAll('.btn, .nav-link, .card').forEach(el => {
    el.addEventListener('mouseenter', () => {
        hoverSound.currentTime = 0;
        hoverSound.play().catch(() => {});
    });
});
*/
