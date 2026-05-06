document.addEventListener('DOMContentLoaded', () => {
    // Load User Data from LocalStorage
    const storedUser = JSON.parse(localStorage.getItem('moura_leite_user')) || {
        username: 'Carlos Silva',
        points: 2450,
        rank: 'Consultor Ouro',
        dept: 'Vendas'
    };

    let userPoints = storedUser.points;
    const pointsElement = document.getElementById('user-points');
    
    // Visit Tracking (Cumulative Days)
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toDateString();
    const lastVisit = storedUser.lastVisit;

    if (lastVisit !== today) {
        // Increment days logged in on every new unique day
        storedUser.streak = (storedUser.streak || 0) + 1;
        storedUser.visitCount = (storedUser.visitCount || 0) + 1;
        storedUser.lastVisit = today;
        localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));
    }

    // Rank Definitions
    const ranks = [
        { name: 'Iniciante', min: 0, next: 500 },
        { name: 'Bronze', min: 501, next: 1500 },
        { name: 'Prata', min: 1501, next: 3000 },
        { name: 'Ouro', min: 3001, next: 6000 },
        { name: 'Platina', min: 6001, next: 10000 },
        { name: 'Diamante', min: 10001, next: Infinity }
    ];

    // Update UI with User Data
    const updateUIWithUser = () => {
        // Find Current Rank
        const currentRankObj = ranks.find((r, i) => userPoints <= r.next) || ranks[ranks.length-1];
        const nextRankObj = ranks[ranks.indexOf(currentRankObj) + 1] || currentRankObj;
        
        storedUser.rank = currentRankObj.name;

        // Update Sidebar
        const sidebarName = document.querySelector('.user-info .name');
        const sidebarRank = document.querySelector('.user-info .rank');
        const userAvatar = document.getElementById('user-avatar-img');
        const streakElement = document.getElementById('user-streak');
        
        if (sidebarName) sidebarName.textContent = storedUser.username;
        if (sidebarRank) sidebarRank.textContent = storedUser.rank;
        if (userAvatar) {
            userAvatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(storedUser.username)}&background=006837&color=fff`;
        }
        if (streakElement) {
            streakElement.textContent = `${storedUser.streak || 1} Dias`;
        }

        // Update Hero Progress
        const heroTitle = document.querySelector('.hero-text h1');
        const heroSub = document.querySelector('.hero-text p');
        const rankFill = document.querySelector('.rank-bar-fill');
        const rankLabels = document.querySelectorAll('.rank-labels span');
        const rankStatusText = document.querySelector('.rank-status');

        if (heroTitle) heroTitle.textContent = `Olá, ${storedUser.username.split(' ')[0]}! 👋`;
        
        if (currentRankObj !== nextRankObj) {
            const pointsForNext = nextRankObj.min - userPoints;
            if (heroSub) heroSub.innerHTML = `Você está a apenas <strong>${pointsForNext} pontos</strong> de subir para o nível <strong>${nextRankObj.name}</strong>.`;
            
            // Progress Bar Logic
            const range = nextRankObj.min - currentRankObj.min;
            const progress = ((userPoints - currentRankObj.min) / range) * 100;
            if (rankFill) rankFill.style.width = `${Math.max(5, progress)}%`;
            if (rankLabels.length >= 2) {
                rankLabels[0].textContent = currentRankObj.name;
                rankLabels[1].textContent = nextRankObj.name;
            }
            if (rankStatusText) rankStatusText.textContent = `${Math.floor(progress)}% concluído`;
        } else {
            if (heroSub) heroSub.innerHTML = `Parabéns! Você atingiu o nível máximo: <strong>${currentRankObj.name}</strong>.`;
            if (rankFill) rankFill.style.width = '100%';
            if (rankStatusText) rankStatusText.textContent = 'Nível Máximo Atingido';
        }

        // Update Goals Widget
        const metaText = document.getElementById('meta-text');
        const metaPercent = document.getElementById('meta-percent');
        const metaStatus = document.getElementById('meta-status');
        const circle = document.getElementById('main-progress');

        // Logic for goals (Admin gets 3/4, others 0/4)
        const totalGoals = 4;
        const completedGoals = storedUser.email === 'admin@mouraleite.com.br' ? 3 : 0;
        const percentage = (completedGoals / totalGoals) * 100;

        if (metaText) metaText.textContent = `Metas: ${completedGoals} de ${totalGoals} completadas`;
        if (metaPercent) metaPercent.textContent = `${percentage}%`;
        if (metaStatus) {
            metaStatus.textContent = percentage >= 75 ? 'Status: Excelente' : 'Status: Iniciando';
        }

        // Animate Circle
        if (circle) {
            const radius = circle.r.baseVal.value;
            const circumference = radius * 2 * Math.PI;
            circle.style.strokeDasharray = `${circumference} ${circumference}`;
            const offset = circumference - (percentage / 100 * circumference);
            
            setTimeout(() => {
                circle.style.strokeDashoffset = offset;
            }, 500);
        }
    };

    updateUIWithUser();

    // Achievement Management
    const updateAchievements = () => {
        const achCards = document.querySelectorAll('.achievement-card');
        const visits = storedUser.visitCount || 1;
        const streak = storedUser.streak || 1;

        // Welcome (Always unlocked if logged in)
        
        // Frequency (10 dias totais)
        if (visits >= 10) {
            const freqAch = achCards[1];
            if (freqAch && freqAch.classList.contains('locked')) {
                freqAch.classList.remove('locked');
                freqAch.classList.add('unlocked');
                freqAch.querySelector('.lock-overlay')?.remove();
            }
        }
        // Centenário (100 dias totais)
        if (visits >= 100) {
            const centAch = achCards[2];
            if (centAch && centAch.classList.contains('locked')) {
                centAch.classList.remove('locked');
                centAch.classList.add('unlocked');
                centAch.querySelector('.lock-overlay')?.remove();
            }
        }
    };

    // Update Ranking with All Users (excluding admin)
    const updateRanking = () => {
        const rankingContainer = document.querySelector('.ranking-list');
        if (!rankingContainer) return;

        // Get all users from global list
        const allUsers = JSON.parse(localStorage.getItem('moura_leite_all_users')) || [];
        
        // Filter out admin and sort by points
        const sortedUsers = allUsers
            .filter(u => u.email !== 'admin@mouraleite.com.br')
            .sort((a, b) => b.points - a.points);

        if (sortedUsers.length === 0) {
            rankingContainer.innerHTML = '<p style="padding:1rem; color:#999; text-align:center;">Nenhum usuário no ranking.</p>';
            return;
        }

        rankingContainer.innerHTML = sortedUsers.map((user, index) => {
            const isMe = user.email === storedUser.email;
            const rankClass = index === 0 ? 'first' : (isMe ? 'me' : '');
            
            return `
                <div class="rank-item ${rankClass}">
                    <span class="pos">${index + 1}</span>
                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(user.username)}&background=${index === 0 ? 'F1863B' : '006837'}&color=fff" alt="">
                    <span class="name">${isMe ? 'Você' : user.username}</span>
                    <span class="pts">${user.points.toLocaleString()} pts</span>
                </div>
            `;
        }).join('');
    };

    updateRanking();

    // Modal Toggle for Ranks
    const btnVerNiveis = document.getElementById('btn-ver-niveis');
    const modalRanks = document.getElementById('ranks-modal');
    const btnCloseRanks = document.getElementById('close-ranks');

    if (btnVerNiveis) {
        btnVerNiveis.addEventListener('click', () => {
            modalRanks.classList.remove('hidden');
        });
    }

    if (btnCloseRanks) {
        btnCloseRanks.addEventListener('click', () => {
            modalRanks.classList.add('hidden');
        });
    }

    window.addEventListener('click', (e) => {
        if (e.target === modalRanks) {
            modalRanks.classList.add('hidden');
        }
    });

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (confirm('Deseja realmente sair?')) {
                localStorage.removeItem('moura_leite_user');
                window.location.href = 'login.html';
            }
        });
    }

    // Navigation handling
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.page-section');

    window.showPage = function(pageId) {
        // Hide all sections
        sections.forEach(sec => sec.classList.add('hidden'));
        
        // Show target section
        const targetSection = document.getElementById(`${pageId}-page`);
        if (targetSection) {
            targetSection.classList.remove('hidden');
            targetSection.classList.add('content-fade');
        }

        // Update active nav item
        navItems.forEach(item => {
            item.classList.remove('active');
            if (item.getAttribute('data-page') === pageId) {
                item.classList.add('active');
            }
        });

        console.log(`Navigating to ${pageId}`);
    };

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.getAttribute('data-page');
            showPage(page);
        });
    });

    // Store Logic
    window.buyItem = function(itemName, price) {
        if (userPoints >= price) {
            const confirmPurchase = confirm(`Deseja trocar ${price} pontos por 1x ${itemName}?`);
            if (confirmPurchase) {
                userPoints -= price;
                updatePointsDisplay();
                
                // Record history
                const now = new Date();
                const newTransaction = {
                    user: storedUser.username,
                    item: itemName,
                    date: now.toLocaleDateString('pt-BR'),
                    time: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                    status: 'Concluído'
                };
                
                // User private history
                if (!storedUser.history) storedUser.history = [];
                storedUser.history.unshift(newTransaction);

                // Global history (for Admin)
                const globalHistory = JSON.parse(localStorage.getItem('moura_leite_global_history')) || [];
                globalHistory.unshift(newTransaction);
                localStorage.setItem('moura_leite_global_history', JSON.stringify(globalHistory));

                // Persist changes
                storedUser.points = userPoints;
                localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));
                
                // Sync with Global List
                const allUsers = JSON.parse(localStorage.getItem('moura_leite_all_users')) || [];
                const userIndex = allUsers.findIndex(u => u.email === storedUser.email);
                if (userIndex !== -1) {
                    allUsers[userIndex].points = userPoints;
                    localStorage.setItem('moura_leite_all_users', JSON.stringify(allUsers));
                }
                
                updateRanking(); // Refresh ranking display
                addNotification(`Você resgatou: ${itemName}. Retire no RH!`);
                alert(`Sucesso! Você adquiriu: ${itemName}. Retire seu item no RH.`);
            }
        } else {
            alert(`Pontos insuficientes! Você precisa de mais ${price - userPoints} pontos para este item.`);
        }
    };

    // History Rendering
    const renderHistory = () => {
        const historyBody = document.getElementById('history-body');
        const historyHeader = document.querySelector('.history-table thead tr');
        const isAdmin = storedUser.email === 'admin@mouraleite.com.br';
        
        const historyData = isAdmin 
            ? (JSON.parse(localStorage.getItem('moura_leite_global_history')) || [])
            : (JSON.parse(localStorage.getItem('moura_leite_user'))?.history || []);
        
        if (!historyBody || !historyHeader) return;

        // Update Header for Admin
        if (isAdmin) {
            historyHeader.innerHTML = `
                <th>Usuário</th>
                <th>Item</th>
                <th>Data</th>
                <th>Horário</th>
                <th>Status</th>
            `;
        } else {
            historyHeader.innerHTML = `
                <th>Item</th>
                <th>Data</th>
                <th>Horário</th>
                <th>Status</th>
            `;
        }

        if (historyData.length === 0) {
            const colCount = isAdmin ? 5 : 4;
            historyBody.innerHTML = `<tr><td colspan="${colCount}" style="text-align: center; padding: 2rem; color: #999;">Nenhum resgate realizado ainda.</td></tr>`;
            return;
        }

        historyBody.innerHTML = historyData.map(tx => `
            <tr>
                ${isAdmin ? `<td><strong>${tx.user}</strong></td>` : ''}
                <td>${tx.item}</td>
                <td>${tx.date}</td>
                <td>${tx.time}</td>
                <td><span class="status-badge">${tx.status}</span></td>
            </tr>
        `).join('');
    };

    // Update the showPage function to render history/achievements when needed
    const originalShowPage = window.showPage;
    window.showPage = function(pageId) {
        originalShowPage(pageId);
        if (pageId === 'historico') {
            renderHistory();
        }
        if (pageId === 'conquistas') {
            updateAchievements();
        }
    };

    function updatePointsDisplay() {
        if (pointsElement) {
            pointsElement.innerHTML = userPoints.toLocaleString();
        }
    }

    // Notifications Logic
    const renderNotifications = () => {
        const notifList = document.getElementById('notif-list');
        const notifBadge = document.getElementById('notif-badge');
        const notifications = storedUser.notifications || [];
        
        if (!notifList || !notifBadge) return;

        notifBadge.textContent = notifications.length;
        notifBadge.style.display = notifications.length > 0 ? 'flex' : 'none';

        if (notifications.length === 0) {
            notifList.innerHTML = '<p style="padding:1rem; font-size:0.8rem; color:#999; text-align:center;">Nenhuma notificação nova.</p>';
            return;
        }

        notifList.innerHTML = notifications.map(n => `
            <div class="notif-item">
                <p>${n.text}</p>
                <span>${n.time}</span>
            </div>
        `).join('');
    };

    const addNotification = (text) => {
        if (!storedUser.notifications) storedUser.notifications = [];
        const now = new Date();
        const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        
        storedUser.notifications.unshift({ text, time: timeStr });
        localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));
        renderNotifications();
    };

    // Initial Notification for new users
    if (!storedUser.notifications || storedUser.notifications.length === 0) {
        addNotification(`Bem-vindo ao portal, ${storedUser.username}! Comece completando suas missões.`);
    }

    // Toggle Dropdown
    const notifBtn = document.getElementById('notification-btn');
    const notifDropdown = document.getElementById('notif-dropdown');
    if (notifBtn) {
        notifBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            notifDropdown.classList.toggle('hidden');
        });
    }

    document.addEventListener('click', () => {
        if (notifDropdown) notifDropdown.classList.add('hidden');
    });

    if (notifDropdown) {
        notifDropdown.addEventListener('click', (e) => e.stopPropagation());
    }

    const clearNotifsBtn = document.getElementById('clear-notifs');
    if (clearNotifsBtn) {
        clearNotifsBtn.addEventListener('click', () => {
            storedUser.notifications = [];
            localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));
            renderNotifications();
        });
    }

    renderNotifications();

    // Initial point animation
    setTimeout(() => {
        updatePointsDisplay();
    }, 1500);
});
