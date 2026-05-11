document.addEventListener('DOMContentLoaded', () => {
    // Global Master Reset (One-time for all users)
    if (!localStorage.getItem('moura_leite_master_reset_v2')) {
        let allUsers = JSON.parse(localStorage.getItem('moura_leite_all_users')) || [];
        
        // Ensure Admin exists in the global list
        if (!allUsers.find(u => u.email === 'admin@mouraleite.com.br')) {
            allUsers.push({
                username: 'ADMIN',
                email: 'admin@mouraleite.com.br',
                points: 1500,
                dept: 'Tecnologia',
                rank: 'Consultor Ouro',
                password: 'admin'
            });
        }

        allUsers.forEach(user => {
            if (user.email !== 'admin@mouraleite.com.br') {
                user.points = 0;
                user.history = [];
                user.lastCheckIn = null;
                user.lastLunchWeek = null;
                user.lastReuniaoWeek = null;
                user.lastGamesWeek = null;
                user.lastLinkedInMonth = null;
                user.lastVivaEngageMonth = null;
                user.lunchCount = 0;
                user.linkedInCount = 0;
                user.vivaEngageCount = 0;
                user.streak = 1;
                user.visitCount = 1;
            }
        });
        localStorage.setItem('moura_leite_all_users', JSON.stringify(allUsers));
        localStorage.setItem('moura_leite_global_history', JSON.stringify([]));
        
        // Update current session if not admin
        let sessionUser = JSON.parse(localStorage.getItem('moura_leite_user'));
        if (sessionUser && sessionUser.email !== 'admin@mouraleite.com.br') {
            sessionUser.points = 0;
            sessionUser.history = [];
            sessionUser.lastCheckIn = null;
            sessionUser.lastLunchWeek = null;
            sessionUser.lastReuniaoWeek = null;
            sessionUser.lastGamesWeek = null;
            sessionUser.lastLinkedInMonth = null;
            sessionUser.lastVivaEngageMonth = null;
            sessionUser.lunchCount = 0;
            sessionUser.linkedInCount = 0;
            sessionUser.vivaEngageCount = 0;
            localStorage.setItem('moura_leite_user', JSON.stringify(sessionUser));
        }
        
        localStorage.setItem('moura_leite_master_reset_v2', 'true');
        window.location.reload();
    }

    // Server Time Validation (Anti-cheat: prevent Windows date manipulation)
    let serverTimeOffset = 0;
    let serverTimeLastSync = Date.now();

    const syncServerTime = async () => {
        try {
            // Use Firebase server timestamp as reference
            const testRef = db.collection('_server_time').doc('sync');
            const syncDoc = await testRef.get();
            const serverTime = syncDoc.exists && syncDoc.data().timestamp 
                ? syncDoc.data().timestamp.toDate().getTime()
                : Date.now();
            
            serverTimeOffset = serverTime - Date.now();
            serverTimeLastSync = Date.now();
            console.log('Server time synced, offset:', serverTimeOffset, 'ms');
        } catch (e) {
            console.warn('Could not sync server time:', e);
        }
    };

    const getServerTime = () => {
        // If last sync was over 5 minutes ago, use local time with caution
        const timeSinceSync = Date.now() - serverTimeLastSync;
        if (timeSinceSync > 300000) {
            // 5 minutes passed, prefer local with notification
            return Date.now();
        }
        return Date.now() + serverTimeOffset;
    };

    const logMissionAttempt = async (userId, missionId, missionName, success, timestamp) => {
        try {
            const logsRef = db.collection('mission_logs').doc();
            await logsRef.set({
                userId,
                missionId,
                missionName,
                success,
                clientTime: new Date(timestamp),
                serverTime: firebase.firestore.FieldValue.serverTimestamp(),
                userAgent: navigator.userAgent
            });
        } catch (e) {
            console.error('Error logging mission attempt:', e);
        }
    };

    // Initial sync on page load
    syncServerTime();

    // Resync every 10 minutes
    setInterval(syncServerTime, 600000);

    // Load User Data from LocalStorage (Current Session)
    const storedUser = JSON.parse(localStorage.getItem('moura_leite_user')) || {
        username: 'Novo Colaborador',
        points: 0,
        rank: 'Iniciante',
        dept: 'Moura Leite'
    };

    // Firebase Real-time Synchronization for Global Users
    db.collection("users").onSnapshot((snapshot) => {
        const usersArray = [];
        snapshot.forEach((doc) => {
            usersArray.push(doc.data());
        });
        
        // Update local global list
        localStorage.setItem('moura_leite_all_users', JSON.stringify(usersArray));
        
        // Re-render UI components that depend on global data
        if (typeof updateRanking === 'function') updateRanking();
        if (typeof renderAdminUsers === 'function') renderAdminUsers();
    });

    // Visit Tracking & Date Helpers (Now using server-synced time)
    const now = new Date(getServerTime());
    const todayStr = now.toDateString();
    const currentMonth = (now.getMonth() + 1) + '-' + now.getFullYear();
    
    const getWeekNumber = (date) => {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
        return Math.ceil((((d - yearStart) / 86400000) + 1)/7) + '-' + d.getUTCFullYear();
    };
    const currentWeek = getWeekNumber(now);

    // Migration/Reset Fix: Force Alex to 0 if he has legacy points (One-time)
    if (storedUser.email === 'alex.landuci@mouraleite.com.br' && !storedUser.legacyReset) {
        storedUser.username = 'Alexsanderson Landuci'; // Force correct name
        storedUser.dept = 'RH';
        storedUser.diretoria = 'Financeira';
        if (storedUser.points === 2450 || storedUser.points === 800) {
            storedUser.points = 0;
            // Sync with global list
            const allUsers = JSON.parse(localStorage.getItem('moura_leite_all_users')) || [];
            const idx = allUsers.findIndex(u => u.email === storedUser.email);
            if (idx !== -1) {
                allUsers[idx].username = 'Alexsanderson Landuci';
                allUsers[idx].points = 0;
                localStorage.setItem('moura_leite_all_users', JSON.stringify(allUsers));
            }
        }
        storedUser.legacyReset = true;
        localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));
    }

    // Force Admin name
    if (storedUser.email === 'admin@mouraleite.com.br') {
        storedUser.username = 'ADMIN';
    }

    const isAdmin = storedUser.email === 'admin@mouraleite.com.br';
    const adminMenuItem = document.getElementById('admin-menu-item');
    const adminMissionsMenuItem = document.getElementById('admin-missions-menu-item');
    if (isAdmin && adminMenuItem) {
        adminMenuItem.classList.remove('hidden');
    }
    if (isAdmin && adminMissionsMenuItem) {
        adminMissionsMenuItem.classList.remove('hidden');
    }

    // Admin User Management Logic
    const renderAdminUsers = () => {
        const body = document.getElementById('admin-users-body');
        if (!body) return;

        const allUsers = JSON.parse(localStorage.getItem('moura_leite_all_users')) || [];
        
        body.innerHTML = allUsers.map(user => {
            const statusLabel = user.disabled ? 'Inativo' : 'Ativo';
            const statusClass = user.disabled ? 'status-locked' : 'status-unlocked';
            
            return `
                <tr>
                    <td><strong>${user.username}</strong></td>
                    <td>${user.email}</td>
                    <td>${user.dept || '-'}</td>
                    <td>${user.diretoria || '-'}</td>
                    <td>${user.points} pts</td>
                    <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                    <td>
                        <div style="display:flex; gap:5px; flex-wrap:wrap;">
                            <button onclick="editUser('${user.email}')" class="btn-buy" style="padding:4px 8px; font-size:10px;">Editar</button>
                            <button onclick="resetUserPassword('${user.email}')" class="btn-buy" style="padding:4px 8px; font-size:10px; background:#f39c12;">Resetar Senha</button>
                            <button onclick="toggleUserStatus('${user.email}')" class="btn-buy" style="padding:4px 8px; font-size:10px; background:#666;">${user.disabled ? 'Ativar' : 'Desativar'}</button>
                            ${user.email !== 'admin@mouraleite.com.br' ? `<button onclick="deleteUser('${user.email}')" class="btn-buy" style="padding:4px 8px; font-size:10px; background:#d32f2f;">Excluir</button>` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    };

    // Admin Mission Creation Logic
    const renderAdminMissions = () => {
        const form = document.getElementById('mission-form');
        const iconSelect = document.getElementById('mission-icon');
        const iconPreview = document.getElementById('mission-icon-preview');

        if (iconSelect && iconPreview) {
            const updateIconPreview = () => {
                const iconValue = iconSelect.value || 'fa-question';
                iconPreview.innerHTML = `<i class="fa-solid ${iconValue}"></i>`;
            };
            iconSelect.addEventListener('change', updateIconPreview);
            updateIconPreview();
        }

        if (form) {
            form.addEventListener('submit', handleMissionSubmit);
        }
    };

    const renderCustomMissions = () => {
        const questsGrid = document.getElementById('quests-grid');
        if (!questsGrid) return;

        // Remove previously injected custom missions to avoid duplicates
        questsGrid.querySelectorAll('.custom-quest-card').forEach(card => card.remove());

        const missions = JSON.parse(localStorage.getItem('moura_leite_missions')) || [];
        if (missions.length === 0) {
            return;
        }

        const multiplier = getCurrentMultiplier();
        questsGrid.insertAdjacentHTML('beforeend', missions
            .filter(m => m.active)
            .map(mission => {
                const badgeLabel = mission.frequency === 'daily' ? 'Diário' : mission.frequency === 'weekly' ? 'Semanal' : 'Mensal';
                const pointValue = Math.floor((mission.points || 0) * multiplier);
                const iconClass = mission.icon ? `fa-solid ${mission.icon}` : 'fa-solid fa-bullseye';
                const iconColor = mission.color || '#1976d2';
                
                // Check if mission was already completed this period
                const lastKey = mission.frequency === 'daily' ? 'lastCustomDaily_' + mission.id
                              : mission.frequency === 'weekly' ? 'lastCustomWeekly_' + mission.id
                              : 'lastCustomMonthly_' + mission.id;
                const dateKey = mission.frequency === 'daily' ? todayStr
                             : mission.frequency === 'weekly' ? currentWeek
                             : currentMonth;
                
                const isCompleted = storedUser[lastKey] === dateKey;
                const buttonText = isCompleted ? 'Concluído' : 
                    (mission.validationType === 'photo' ? 'Enviar Foto' : 
                     mission.validationType === 'link' ? 'Enviar Link' : 'Validar');
                const buttonDisabled = isCompleted ? 'disabled' : '';
                const actionLabel = mission.validationType === 'photo' ? 'Enviar Foto' : mission.validationType === 'link' ? 'Enviar Link' : 'Validar';
                
                const adminActions = isAdmin ? `
                            <div class="admin-mission-actions">
                                <button class="btn-admin-action" onclick="editMission('${mission.id}')">Editar</button>
                                <button class="btn-admin-action btn-delete" onclick="deleteMission('${mission.id}')">Excluir</button>
                            </div>
                        ` : '';

                return `
                    <div class="quest-card custom-quest-card">
                        <div class="quest-badge ${mission.frequency}">${badgeLabel}</div>
                        <i class="${iconClass} quest-main-icon" style="color: ${iconColor};"></i>
                        <h3>${mission.name}</h3>
                        <p>${mission.description}</p>
                        <div class="quest-footer">
                            <span class="pts-gain">+${pointValue} pts</span>
                            <button class="btn-checkin custom-mission-btn" ${buttonDisabled} data-mission-id="${mission.id}" data-mission-name="${mission.name}" data-mission-points="${mission.points}" data-validation-type="${mission.validationType}" data-frequency="${mission.frequency}">${buttonText}</button>
                        </div>
                        ${adminActions}
                    </div>
                `;
            })
            .join(''));
    };

    const handleMissionSubmit = async (e) => {
        e.preventDefault();
        
        const name = document.getElementById('mission-name').value;
        const frequency = document.getElementById('mission-frequency').value;
        const description = document.getElementById('mission-description').value;
        const points = parseInt(document.getElementById('mission-points').value);
        const icon = document.getElementById('mission-icon').value;
        const color = document.getElementById('mission-color').value;
        const validationType = document.getElementById('mission-validation-type').value;
        const active = document.getElementById('mission-active').checked;

        const newMission = {
            id: Date.now().toString(),
            name,
            frequency,
            description,
            points,
            icon,
            color,
            validationType,
            active,
            createdAt: new Date().toISOString()
        };

        try {
            // Save to localStorage for now (could be Firebase later)
            const missions = JSON.parse(localStorage.getItem('moura_leite_missions')) || [];
            missions.push(newMission);
            localStorage.setItem('moura_leite_missions', JSON.stringify(missions));

            alert('Missão cadastrada com sucesso!');
            
            // Reset form
            document.getElementById('mission-form').reset();
            document.getElementById('mission-color').value = '#1976d2';
            renderCustomMissions();
        } catch (error) {
            console.error('Erro ao cadastrar missão:', error);
            alert('Erro ao cadastrar missão.');
        }
    };

    window.deleteMission = (missionId) => {
        if (!confirm('Deseja excluir esta missão permanentemente?')) return;
        const missions = JSON.parse(localStorage.getItem('moura_leite_missions')) || [];
        const updated = missions.filter(m => m.id !== missionId);
        localStorage.setItem('moura_leite_missions', JSON.stringify(updated));
        renderCustomMissions();
        alert('Missão excluída com sucesso.');
    };

    window.editMission = (missionId) => {
        const missions = JSON.parse(localStorage.getItem('moura_leite_missions')) || [];
        const mission = missions.find(m => m.id === missionId);
        if (!mission) return alert('Missão não encontrada.');

        const newName = prompt('Nome da missão:', mission.name);
        if (newName === null) return;
        const newDescription = prompt('Descrição:', mission.description);
        if (newDescription === null) return;
        const newPoints = prompt('Pontos:', mission.points);
        if (newPoints === null) return;
        const newFrequency = prompt('Frequência (daily, weekly, monthly):', mission.frequency);
        if (newFrequency === null) return;
        const newValidationType = prompt('Tipo de validação (button, photo, link):', mission.validationType);
        if (newValidationType === null) return;

        mission.name = newName.trim() || mission.name;
        mission.description = newDescription.trim() || mission.description;
        mission.points = parseInt(newPoints) || mission.points;
        mission.frequency = ['daily','weekly','monthly'].includes(newFrequency) ? newFrequency : mission.frequency;
        mission.validationType = ['button','photo','link'].includes(newValidationType) ? newValidationType : mission.validationType;

        localStorage.setItem('moura_leite_missions', JSON.stringify(missions));
        renderCustomMissions();
        alert('Missão atualizada com sucesso.');
    };

    window.resetUserPassword = async (email) => {
        const newPass = prompt(`Digite a nova senha para o usuário:`);
        if (newPass) {
            try {
                await db.collection("users").doc(email).update({ password: newPass });
                alert(`Senha alterada com sucesso!`);
                addNotification(`Senha resetada pelo administrador.`);
            } catch (e) {
                console.error(e);
                alert("Erro ao alterar senha.");
            }
        }
    };

    window.toggleUserStatus = async (email) => {
        const allUsers = JSON.parse(localStorage.getItem('moura_leite_all_users')) || [];
        const user = allUsers.find(u => u.email === email);
        if (user) {
            try {
                await db.collection("users").doc(email).update({ disabled: !user.disabled });
            } catch (e) {
                console.error(e);
                alert("Erro ao alterar status.");
            }
        }
    };

    window.deleteUser = async (email) => {
        if (confirm(`Tem certeza que deseja EXCLUIR permanentemente o usuário ${email}?`)) {
            try {
                await db.collection("users").doc(email).delete();
                alert('Usuário excluído!');
            } catch (e) {
                console.error(e);
                alert("Erro ao excluir.");
            }
        }
    };

    window.editUser = async (email) => {
        const allUsers = JSON.parse(localStorage.getItem('moura_leite_all_users')) || [];
        const user = allUsers.find(u => u.email === email);
        if (user) {
            const newName = prompt('Novo nome:', user.username);
            const newPoints = prompt('Novos pontos:', user.points);
            
            let updates = {};
            if (newName !== null) updates.username = newName;
            if (newPoints !== null) {
                const p = parseInt(newPoints) || 0;
                updates.points = p;
                
                // If editing self, update current session variables immediately
                if (email === storedUser.email) {
                    storedUser.points = p;
                    userPoints = p;
                    localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));
                    updatePointsDisplay();
                    updateUIWithUser();
                }
            }
            
            if (newName !== null && email === storedUser.email) {
                storedUser.username = newName;
                localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));
                updateUIWithUser();
            }

            if (Object.keys(updates).length > 0) {
                try {
                    await db.collection("users").doc(email).update(updates);
                    addNotification(`Usuário ${email} editado.`);
                } catch (e) {
                    console.error("Erro ao editar", e);
                    alert("Erro ao editar usuário.");
                }
            }
        }
    };

    let userPoints = storedUser.points;
    const pointsElement = document.getElementById('user-points');
    
    // Visit Tracking (Cumulative Days)
    const today = todayStr;
    const lastVisit = storedUser.lastVisit;

    if (lastVisit !== today) {
        storedUser.streak = (storedUser.streak || 0) + 1;
        storedUser.visitCount = (storedUser.visitCount || 0) + 1;
        storedUser.lastVisit = today;
        localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));
    }

    // Rank Definitions
    const ranks = [
        { name: 'Iniciante', min: 0, next: 500, icon: 'fa-seedling', class: 'rank-iniciante', multiplier: 1.0 },
        { name: 'Bronze', min: 501, next: 1500, icon: 'fa-medal', class: 'rank-bronze', multiplier: 1.1 },
        { name: 'Prata', min: 1501, next: 3000, icon: 'fa-award', class: 'rank-prata', multiplier: 1.2 },
        { name: 'Ouro', min: 3001, next: 6000, icon: 'fa-trophy', class: 'rank-ouro', multiplier: 1.5 },
        { name: 'Platina', min: 6001, next: 10000, icon: 'fa-crown', class: 'rank-platina', multiplier: 2.0 },
        { name: 'Diamante', min: 10001, next: Infinity, icon: 'fa-gem', class: 'rank-diamante', multiplier: 1.0 }
    ];

    const getCurrentMultiplier = () => {
        const currentRankObj = ranks.find((r, i) => userPoints <= r.next) || ranks[ranks.length-1];
        return currentRankObj.multiplier || 1.0;
    };

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
        const heroRankIcon = document.getElementById('hero-rank-icon');

        if (heroTitle) heroTitle.textContent = `Olá, ${storedUser.username.split(' ')[0]}! 👋`;
        
        // Inject Hero Rank Icon
        if (heroRankIcon) {
            heroRankIcon.innerHTML = `<i class="fa-solid ${currentRankObj.icon}"></i>`;
            heroRankIcon.className = `hero-rank-badge ${currentRankObj.class}`;
        }
        
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
            if (rankLabels.length >= 2) {
                const prevRank = ranks[ranks.indexOf(currentRankObj) - 1] || currentRankObj;
                rankLabels[0].textContent = prevRank.name;
                rankLabels[1].textContent = currentRankObj.name;
            }
        }

        // Update Goals Widget (Dynamic Integration)
        const metaText = document.getElementById('meta-text');
        const metaPercent = document.getElementById('meta-percent');
        const metaStatus = document.getElementById('meta-status');
        const circle = document.getElementById('main-progress');

        const totalGoals = 6;
        let completedGoals = 0;

        // Check Goal 1: Daily Check-in
        if (storedUser.lastCheckIn === todayStr) completedGoals++;

        // Check Goal 2: Weekly Lunch/Integração entre Times
        if (storedUser.lastLunchWeek === currentWeek) completedGoals++;

        // Check Goal 3: Weekly Reunião de Integração
        if (storedUser.lastReuniaoWeek === currentWeek) completedGoals++;

        // Check Goal 4: Monthly Embaixador Digital
        if (storedUser.lastLinkedInMonth === currentMonth) completedGoals++;

        // Check Goal 5: Monthly Viva Engage
        if (storedUser.lastVivaEngageMonth === currentMonth) completedGoals++;

        // Check Goal 6: Weekly Tarde dos Jogos
        if (storedUser.lastGamesWeek === currentWeek) completedGoals++;

        const percentage = (completedGoals / totalGoals) * 100;

        if (metaText) metaText.textContent = `Metas: ${completedGoals} de ${totalGoals} completadas`;
        if (metaPercent) metaPercent.textContent = `${Math.floor(percentage)}%`;
        if (metaStatus) {
            if (percentage === 0) metaStatus.textContent = 'Status: Iniciando';
            else if (percentage < 50) metaStatus.textContent = 'Status: Em progresso';
            else if (percentage < 100) metaStatus.textContent = 'Status: Muito bom';
            else metaStatus.textContent = 'Status: Excelente';
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

        // Update Quest Labels based on multiplier
        const multiplier = getCurrentMultiplier();
        const checkinBtn = document.getElementById('checkin-btn');
        const lunchBtn = document.getElementById('lunch-btn');
        const embaixadorBtn = document.getElementById('embaixador-btn');
        const jogosBtn = document.getElementById('jogos-btn');
        
        if (checkinBtn && !checkinBtn.disabled) checkinBtn.textContent = `+${Math.floor(1 * multiplier)} pts`;
        if (lunchBtn && !lunchBtn.disabled) lunchBtn.textContent = `+${Math.floor(5 * multiplier)} pts`;
        if (embaixadorBtn && !embaixadorBtn.disabled) embaixadorBtn.textContent = `+${Math.floor(15 * multiplier)} pts`;
        if (jogosBtn && !jogosBtn.disabled) jogosBtn.textContent = `+${Math.floor(20 * multiplier)} pts`;

        const ptsSpans = document.querySelectorAll('.pts-gain');
        if (ptsSpans.length >= 4) {
             ptsSpans[0].textContent = `+${Math.floor(1 * multiplier)} pts`;
             ptsSpans[1].textContent = `+${Math.floor(5 * multiplier)} pts`;
             ptsSpans[2].textContent = `+${Math.floor(15 * multiplier)} pts`;
             ptsSpans[3].textContent = `+${Math.floor(20 * multiplier)} pts`;
        }
    };

    updateUIWithUser();

    // Achievement Management
    const updateAchievements = () => {
        const achCards = document.querySelectorAll('.achievement-card');
        const visits = storedUser.visitCount || 1;
        
        // Frequency (10 dias totais)
        if (visits >= 10) unlockAch(achCards[1]);
        // Centenário (100 dias totais)
        if (visits >= 100) unlockAch(achCards[2]);

        // Amigo da Galera (24 almoços)
        if ((storedUser.lunchCount || 0) >= 24) unlockAch(achCards[4]);

        // Porta Voz (10 LinkedIn)
        if ((storedUser.linkedInCount || 0) >= 10) unlockAch(achCards[5]);
    };

    function unlockAch(card) {
        if (card && card.classList.contains('locked')) {
            card.classList.remove('locked');
            card.classList.add('unlocked');
            card.querySelector('.lock-overlay')?.remove();
            
            // Add a "Unlocked" badge if it doesn't have a date yet
            if (!card.querySelector('.date-unlocked')) {
                const info = card.querySelector('.achievement-info');
                const badge = document.createElement('span');
                badge.className = 'date-unlocked';
                badge.textContent = 'Conquistado!';
                info.appendChild(badge);
            }
        }
    }

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
            
            // Special rendering for specific pages
            if (pageId === 'admin-users') renderAdminUsers();
            if (pageId === 'admin-missions') renderAdminMissions();
            if (pageId === 'missoes') renderCustomMissions();
            if (pageId === 'historico') renderHistory();
            if (pageId === 'conquistas') updateAchievements();
            if (pageId === 'ranking') renderFullRanking();
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
                updateUIWithUser(); // Refresh banner/ranks
                addNotification(`Você resgatou: ${itemName}. Retire no RH!`);
                alert(`Sucesso! Você adquiriu: ${itemName}. Retire seu item no RH.`);
            }
        } else {
            alert(`Pontos insuficientes! Você precisa de mais ${price - userPoints} pontos para este item.`);
        }
    };

    // History Rendering
    const renderHistory = () => {
        const historyBody = document.querySelector('#historico-page .history-table tbody');
        const historyHeader = document.querySelector('#historico-page .history-table thead tr');
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
                <td>
                    ${tx.item} 
                    ${tx.photo ? `<button class="view-photo-btn" onclick="viewPhoto('${tx.photo}')" title="Ver Comprovante">📸</button>` : ''}
                    ${tx.link ? `<a href="${tx.link}" target="_blank" class="view-link-btn" title="Ver Publicação" style="text-decoration:none; margin-left:5px;">🔗</a>` : ''}
                </td>
                <td>${tx.date}</td>
                <td>${tx.time}</td>
                <td><span class="status-badge">${tx.status}</span></td>
            </tr>
        `).join('');
    };

    // Full Detailed Ranking Rendering
    const renderFullRanking = () => {
        const fullRankingBody = document.getElementById('full-ranking-body');
        if (!fullRankingBody) return;

        const allUsers = JSON.parse(localStorage.getItem('moura_leite_all_users')) || [];
        const sortedUsers = allUsers
            .filter(u => u.email !== 'admin@mouraleite.com.br')
            .sort((a, b) => b.points - a.points);

        fullRankingBody.innerHTML = sortedUsers.map((user, index) => {
            const deptDisplay = user.dept ? (user.dept.length <= 3 ? user.dept.toUpperCase() : user.dept.charAt(0).toUpperCase() + user.dept.slice(1)) : 'Geral';
            const dirDisplay = user.diretoria ? (user.diretoria.charAt(0).toUpperCase() + user.diretoria.slice(1)) : 'Moura Leite';
            
            return `
                <tr>
                    <td><strong>${index + 1}º</strong></td>
                    <td>
                        <div style="display:flex; align-items:center; gap:10px;">
                            <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(user.username)}&background=006837&color=fff" style="width:30px; border-radius:50%;">
                            <span>${user.username}</span>
                        </div>
                    </td>
                    <td>${deptDisplay}</td>
                    <td>${dirDisplay}</td>
                    <td><strong>${user.points.toLocaleString()} pts</strong></td>
                </tr>
            `;
        }).join('');
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

    const checkinBtns = document.querySelectorAll('#checkin-btn, #checkin-btn-full');
    const checkinStatus = document.getElementById('checkin-status');

    const updateCheckinUI = () => {
        if (storedUser.lastCheckIn === todayStr) {
            checkinBtns.forEach(btn => {
                btn.disabled = true;
                btn.textContent = 'Concluído';
            });
            if (checkinStatus) checkinStatus.textContent = 'Você já garantiu seu ponto de hoje!';
        }
    };

    checkinBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (storedUser.lastCheckIn !== todayStr) {
                const multiplier = getCurrentMultiplier();
                const earned = Math.floor(1 * multiplier);
                userPoints += earned;
                storedUser.points = userPoints;
                storedUser.lastCheckIn = todayStr;
                saveAndSync();
                updatePointsDisplay();
                updateRanking();
                updateUIWithUser();
                updateCheckinUI();
                addNotification(`Check-in diário realizado! +${earned} pts.`);
                alert(`Parabéns! Você ganhou ${earned} ponto(s) pelo seu check-in diário.`);
            }
        });
    });

    // Custom Missions Handler
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('custom-mission-btn')) {
            const missionId = e.target.getAttribute('data-mission-id');
            const missionName = e.target.getAttribute('data-mission-name');
            const missionPoints = parseInt(e.target.getAttribute('data-mission-points'));
            const validationType = e.target.getAttribute('data-validation-type');
            const frequency = e.target.getAttribute('data-frequency');

            // Get the last completion key based on frequency
            const lastKey = frequency === 'daily' ? 'lastCustomDaily_' + missionId
                          : frequency === 'weekly' ? 'lastCustomWeekly_' + missionId
                          : 'lastCustomMonthly_' + missionId;
            
            const dateKey = frequency === 'daily' ? todayStr
                         : frequency === 'weekly' ? currentWeek
                         : currentMonth;

            if (storedUser[lastKey] === dateKey) {
                logMissionAttempt(storedUser.email, missionId, missionName, false, getServerTime());
                alert('Você já completou esta missão neste período.');
                return;
            }

            if (validationType === 'photo') {
                const photoInput = document.createElement('input');
                photoInput.type = 'file';
                photoInput.accept = 'image/*';
                photoInput.onchange = () => {
                    const file = photoInput.files[0];
                    if (file) {
                        const reader = new FileReader();
                        reader.onload = () => {
                            completeMissionWithPhoto(missionId, missionName, missionPoints, reader.result, lastKey, dateKey);
                        };
                        reader.readAsDataURL(file);
                    }
                };
                photoInput.click();
            } else if (validationType === 'link') {
                const link = prompt(`Cole o link da ${missionName}:`);
                if (link && link.trim()) {
                    completeMissionWithLink(missionId, missionName, missionPoints, link, lastKey, dateKey);
                }
            } else {
                completeMissionSimple(missionId, missionName, missionPoints, lastKey, dateKey);
            }
        }
    });

    const completeMissionSimple = (missionId, missionName, missionPoints, lastKey, dateKey) => {
        const multiplier = getCurrentMultiplier();
        const earned = Math.floor(missionPoints * multiplier);
        const serverTimestamp = getServerTime();
        
        userPoints += earned;
        storedUser.points = userPoints;
        storedUser[lastKey] = dateKey;
        storedUser.lastMissionTime = serverTimestamp;
        localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));
        
        // Sync with global list
        const allUsers = JSON.parse(localStorage.getItem('moura_leite_all_users')) || [];
        const userIndex = allUsers.findIndex(u => u.email === storedUser.email);
        if (userIndex !== -1) {
            allUsers[userIndex].points = userPoints;
            localStorage.setItem('moura_leite_all_users', JSON.stringify(allUsers));
        }
        
        // Log successful mission
        logMissionAttempt(storedUser.email, missionId, missionName, true, serverTimestamp);
        
        updatePointsDisplay();
        updateRanking();
        updateUIWithUser();
        renderCustomMissions();
        addNotification(`${missionName} concluída! +${earned} pts.`);
        alert(`Parabéns! Você ganhou ${earned} ponto(s) por completar: ${missionName}`);
    };

    const completeMissionWithPhoto = (missionId, missionName, missionPoints, photoData, lastKey, dateKey) => {
        const multiplier = getCurrentMultiplier();
        const earned = Math.floor(missionPoints * multiplier);
        const serverTimestamp = getServerTime();
        
        userPoints += earned;
        storedUser.points = userPoints;
        storedUser[lastKey] = dateKey;
        storedUser.lastMissionTime = serverTimestamp;
        
        // Record in history with photo
        if (!storedUser.history) storedUser.history = [];
        storedUser.history.unshift({
            user: storedUser.username,
            item: `Missão: ${missionName}`,
            date: new Date(serverTimestamp).toLocaleDateString('pt-BR'),
            time: new Date(serverTimestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            status: 'Validando',
            photo: photoData,
            serverTime: serverTimestamp
        });
        
        localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));
        
        // Sync with global list
        const allUsers = JSON.parse(localStorage.getItem('moura_leite_all_users')) || [];
        const userIndex = allUsers.findIndex(u => u.email === storedUser.email);
        if (userIndex !== -1) {
            allUsers[userIndex].points = userPoints;
            localStorage.setItem('moura_leite_all_users', JSON.stringify(allUsers));
        }
        
        // Log successful mission
        logMissionAttempt(storedUser.email, missionId, missionName, true, serverTimestamp);
        
        updatePointsDisplay();
        updateRanking();
        updateUIWithUser();
        renderCustomMissions();
        addNotification(`${missionName} enviada para validação! +${earned} pts.`);
        alert(`Foto enviada! Você ganhou ${earned} pontos por: ${missionName}`);
    };

    const completeMissionWithLink = (missionId, missionName, missionPoints, link, lastKey, dateKey) => {
        const multiplier = getCurrentMultiplier();
        const earned = Math.floor(missionPoints * multiplier);
        const serverTimestamp = getServerTime();
        
        userPoints += earned;
        storedUser.points = userPoints;
        storedUser[lastKey] = dateKey;
        storedUser.lastMissionTime = serverTimestamp;
        
        // Record in history with link
        if (!storedUser.history) storedUser.history = [];
        storedUser.history.unshift({
            user: storedUser.username,
            item: `Missão: ${missionName}`,
            date: new Date(serverTimestamp).toLocaleDateString('pt-BR'),
            time: new Date(serverTimestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            status: 'Validando',
            link: link,
            serverTime: serverTimestamp
        });
        
        localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));
        
        // Sync with global list
        const allUsers = JSON.parse(localStorage.getItem('moura_leite_all_users')) || [];
        const userIndex = allUsers.findIndex(u => u.email === storedUser.email);
        if (userIndex !== -1) {
            allUsers[userIndex].points = userPoints;
            localStorage.setItem('moura_leite_all_users', JSON.stringify(allUsers));
        }
        
        // Log successful mission
        logMissionAttempt(storedUser.email, missionId, missionName, true, serverTimestamp);
        
        updatePointsDisplay();
        updateRanking();
        updateUIWithUser();
        renderCustomMissions();
        addNotification(`${missionName} enviada para validação! +${earned} pts.`);
        alert(`Link enviado! Você ganhou ${earned} pontos por: ${missionName}`);
    };

    // Weekly Lunch Logic with Photo Audit (Multi-location)
    const lunchBtns = document.querySelectorAll('#lunch-btn, #lunch-btn-full');
    const lunchStatus = document.getElementById('lunch-status');
    const lunchPhotoInput = document.getElementById('lunch-photo-input');

    const updateLunchUI = () => {
        if (storedUser.lastLunchWeek === currentWeek) {
            lunchBtns.forEach(btn => {
                btn.disabled = true;
                btn.textContent = 'Concluído';
            });
            if (lunchStatus) lunchStatus.textContent = 'Integração semanal concluída! Parabéns.';
        }
    };

    lunchBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (storedUser.lastLunchWeek !== currentWeek) {
                alert('Para validar essa missão de 5 pontos, você precisa anexar uma foto do almoço com os colegas de outros departamentos.');
                lunchPhotoInput.click();
            }
        });
    });

    if (lunchPhotoInput) {
        lunchPhotoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                const photoData = event.target.result;
                const multiplier = getCurrentMultiplier();
                const earned = Math.floor(5 * multiplier);
                userPoints += earned;
                storedUser.points = userPoints;
                storedUser.lastLunchWeek = currentWeek;
                storedUser.lunchCount = (storedUser.lunchCount || 0) + 1;
                
                const now = new Date();
                const transaction = {
                    user: storedUser.username,
                    item: 'Integração entre Times',
                    date: now.toLocaleDateString('pt-BR'),
                    time: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                    status: 'Concluído',
                    photo: photoData,
                    type: 'Ganho'
                };

                if (!storedUser.history) storedUser.history = [];
                storedUser.history.unshift(transaction);
                
                // Global Sync
                const globalHistory = JSON.parse(localStorage.getItem('moura_leite_global_history')) || [];
                globalHistory.unshift(transaction);
                localStorage.setItem('moura_leite_global_history', JSON.stringify(globalHistory));

                saveAndSync();
                updatePointsDisplay();
                updateRanking();
                updateUIWithUser();
                updateLunchUI();
                addNotification(`Foto enviada e pontos creditados! +${earned} pts.`);
                alert(`Missão concluída com sucesso! Você ganhou ${earned} pontos.`);
            };
            reader.readAsDataURL(file);
        });
    }

    // Reunião de Integração Logic (Weekly)
    const reuniaoBtns = document.querySelectorAll('#reuniao-btn, #reuniao-btn-full');
    const reuniaoPhotoInput = document.getElementById('reuniao-photo-input');

    const updateReuniaoUI = () => {
        if (storedUser.lastReuniaoWeek === currentWeek) {
            reuniaoBtns.forEach(btn => {
                btn.disabled = true;
                btn.textContent = 'Concluído';
            });
        }
    };

    reuniaoBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (storedUser.lastReuniaoWeek !== currentWeek) {
                alert('Para validar esta missão de 8 pontos, anexe uma foto da reunião de integração com colegas de outro setor.');
                if (reuniaoPhotoInput) reuniaoPhotoInput.click();
            }
        });
    });

    if (reuniaoPhotoInput) {
        reuniaoPhotoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                const photoData = event.target.result;
                const multiplier = getCurrentMultiplier();
                const earned = Math.floor(8 * multiplier);
                userPoints += earned;
                storedUser.points = userPoints;
                storedUser.lastReuniaoWeek = currentWeek;
                storedUser.reuniaoCount = (storedUser.reuniaoCount || 0) + 1;

                const now = new Date();
                const transaction = {
                    user: storedUser.username,
                    item: 'Reunião de Integração',
                    date: now.toLocaleDateString('pt-BR'),
                    time: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                    status: 'Concluído',
                    photo: photoData,
                    type: 'Ganho'
                };

                if (!storedUser.history) storedUser.history = [];
                storedUser.history.unshift(transaction);

                const globalHistory = JSON.parse(localStorage.getItem('moura_leite_global_history')) || [];
                globalHistory.unshift(transaction);
                localStorage.setItem('moura_leite_global_history', JSON.stringify(globalHistory));

                saveAndSync();
                updatePointsDisplay();
                updateRanking();
                updateUIWithUser();
                updateReuniaoUI();
                addNotification(`Foto enviada e pontos creditados! +${earned} pts.`);
                alert(`Missão concluída com sucesso! Você ganhou ${earned} pontos.`);
            };
            reader.readAsDataURL(file);
        });
    }

    async function saveAndSync() {
        // Save to current session
        localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));
        
        // Sync to Firestore
        if (storedUser.email) {
            try {
                await db.collection("users").doc(storedUser.email).set(storedUser, { merge: true });
            } catch (e) {
                console.error("Erro ao sincronizar com Firestore:", e);
            }
        }
    }

    // Embaixador Digital Logic (Monthly)
    const embaixadorBtns = document.querySelectorAll('#embaixador-btn, #embaixador-btn-full');

    const updateEmbaixadorUI = () => {
        if (storedUser.lastLinkedInMonth === currentMonth) {
            embaixadorBtns.forEach(btn => {
                btn.disabled = true;
                btn.textContent = 'Concluído';
            });
        }
    };

    embaixadorBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (storedUser.lastLinkedInMonth !== currentMonth) {
                const link = prompt('Insira o link da sua publicação no LinkedIn para validação:');
                
                if (link) {
                    // Validar se é um link real
                    const urlPattern = /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([\/\w .-]*)*\/?$/;
                    if (!urlPattern.test(link)) {
                        alert('Por favor, insira um link válido (ex: https://linkedin.com/...)');
                        return;
                    }

                    const multiplier = getCurrentMultiplier();
                    const earned = Math.floor(15 * multiplier);
                    userPoints += earned;
                    storedUser.points = userPoints;
                    storedUser.lastLinkedInMonth = currentMonth;
                    storedUser.linkedInCount = (storedUser.linkedInCount || 0) + 1;
                    
                    const transaction = {
                        user: storedUser.username,
                        item: 'Embaixador Digital',
                        date: now.toLocaleDateString('pt-BR'),
                        time: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                        status: 'Concluído',
                        link: link,
                        type: 'Ganho'
                    };
                    if (!storedUser.history) storedUser.history = [];
                    storedUser.history.unshift(transaction);
                    
                    // Global Sync
                    const globalHistory = JSON.parse(localStorage.getItem('moura_leite_global_history')) || [];
                    globalHistory.unshift(transaction);
                    localStorage.setItem('moura_leite_global_history', JSON.stringify(globalHistory));
                    
                    saveAndSync();
                    updatePointsDisplay();
                    updateUIWithUser();
                    updateRanking();
                    updateUIWithUser();
                    updateEmbaixadorUI();
                    addNotification(`Missão Embaixador concluída! +${earned} pts.`);
                    alert(`Sucesso! Você ganhou ${earned} pontos.`);
                }
            }
        });
    });

    // Viva Engage Logic (Monthly)
    const vivaengageBtns = document.querySelectorAll('#vivaengage-btn, #vivaengage-btn-full');

    const updateVivaEngageUI = () => {
        if (storedUser.lastVivaEngageMonth === currentMonth) {
            vivaengageBtns.forEach(btn => {
                btn.disabled = true;
                btn.textContent = 'Concluído';
            });
        }
    };

    vivaengageBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (storedUser.lastVivaEngageMonth !== currentMonth) {
                const link = prompt('Insira o link da sua postagem no Viva Engage para validação:');
                
                if (link) {
                    // Validar se é um link real
                    const urlPattern = /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([\/\w .-]*)*\/?$/;
                    if (!urlPattern.test(link)) {
                        alert('Por favor, insira um link válido');
                        return;
                    }

                    const multiplier = getCurrentMultiplier();
                    const earned = Math.floor(12 * multiplier);
                    userPoints += earned;
                    storedUser.points = userPoints;
                    storedUser.lastVivaEngageMonth = currentMonth;
                    storedUser.vivaEngageCount = (storedUser.vivaEngageCount || 0) + 1;
                    
                    const transaction = {
                        user: storedUser.username,
                        item: 'Engajamento Viva Engage',
                        date: now.toLocaleDateString('pt-BR'),
                        time: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                        status: 'Concluído',
                        link: link,
                        type: 'Ganho'
                    };
                    if (!storedUser.history) storedUser.history = [];
                    storedUser.history.unshift(transaction);
                    
                    // Global Sync
                    const globalHistory = JSON.parse(localStorage.getItem('moura_leite_global_history')) || [];
                    globalHistory.unshift(transaction);
                    localStorage.setItem('moura_leite_global_history', JSON.stringify(globalHistory));
                    
                    saveAndSync();
                    updatePointsDisplay();
                    updateUIWithUser();
                    updateRanking();
                    updateUIWithUser();
                    updateVivaEngageUI();
                    addNotification(`Missão Viva Engage concluída! +${earned} pts.`);
                    alert(`Sucesso! Você ganhou ${earned} pontos.`);
                }
            }
        });
    });

    // Tarde dos Jogos Logic (Weekly)
    const jogosBtns = document.querySelectorAll('#jogos-btn, #jogos-btn-full');
    const gamesPhotoInput = document.getElementById('games-photo-input');
    
    const updateJogosUI = () => {
        if (storedUser.lastGamesWeek === currentWeek) {
            jogosBtns.forEach(btn => {
                btn.disabled = true;
                btn.textContent = 'Concluído';
            });
        }
    };

    jogosBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (storedUser.lastGamesWeek !== currentWeek) {
                alert('Para ganhar estes 20 pontos, anexe uma foto da sua participação na Tarde de Jogos.');
                gamesPhotoInput.click();
            }
        });
    });

    if (gamesPhotoInput) {
        gamesPhotoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                const photoData = event.target.result;
                const multiplier = getCurrentMultiplier();
                const earned = Math.floor(20 * multiplier);
                userPoints += earned;
                storedUser.points = userPoints;
                storedUser.lastGamesWeek = currentWeek;
                
                const now = new Date();
                const transaction = {
                    user: storedUser.username,
                    item: 'Tarde dos Jogos',
                    date: now.toLocaleDateString('pt-BR'),
                    time: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                    status: 'Concluído',
                    photo: photoData,
                    type: 'Ganho'
                };

                if (!storedUser.history) storedUser.history = [];
                storedUser.history.unshift(transaction);
                
                // Global Sync
                const globalHistory = JSON.parse(localStorage.getItem('moura_leite_global_history')) || [];
                globalHistory.unshift(transaction);
                localStorage.setItem('moura_leite_global_history', JSON.stringify(globalHistory));

                saveAndSync();
                updatePointsDisplay();
                updateRanking();
                updateUIWithUser();
                updateJogosUI();
                addNotification(`Foto da Tarde de Jogos enviada! +${earned} pts.`);
                alert(`Sucesso! Você ganhou ${earned} pontos!`);
            };
            reader.readAsDataURL(file);
        });
    }

    window.viewPhoto = (photoData) => {
        const viewer = document.createElement('div');
        viewer.style = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); z-index:9999; display:flex; align-items:center; justify-content:center; cursor:pointer;';
        viewer.innerHTML = `<img src="${photoData}" style="max-width:90%; max-height:90%; border-radius:10px; border: 5px solid white;">`;
        viewer.onclick = () => viewer.remove();
        document.body.appendChild(viewer);
    };

    saveAndSync();
    updateCheckinUI();
    updateLunchUI();
    updateEmbaixadorUI();
    updateJogosUI();
    updatePointsDisplay();
    updateRanking();
    updateUIWithUser();
});
