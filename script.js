// Global error handler for debugging
window.addEventListener('error', (event) => {
    console.error('Global script error:', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error?.stack
    });
});

// Check for Firebase availability
console.log('Checking Firebase dependencies...');
const firebaseAvailable = typeof window.firebase !== 'undefined';
const dbAvailable = typeof window.db !== 'undefined';
const dbInstance = dbAvailable ? window.db : null;
const db = dbAvailable ? window.db : null;
if (!firebaseAvailable) {
    console.error('Firebase SDK not loaded - check CDN connection');
}
if (!dbAvailable) {
    console.warn('Firestore db is not available. The app will run in local-only mode.');
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('Script iniciando...', {
        docReady: document.readyState,
        location: window.location.href,
        hasFirebase: firebaseAvailable,
        hasDb: dbAvailable
    });
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
        if (!dbAvailable) {
            console.warn('Skipping server time sync because Firestore is unavailable.');
            return;
        }

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
        if (!dbAvailable) {
            console.warn('Skipping mission log because Firestore is unavailable.');
            return;
        }

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
    if (dbAvailable) {
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
    } else {
        console.warn('Skipping Firestore user sync because db is unavailable.');
    }

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
                    <td>${user.diretoria ? (user.diretoria.replace(/^diretoria-/i, '').charAt(0).toUpperCase() + user.diretoria.replace(/^diretoria-/i, '').slice(1)) : '-'}</td>
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

    const getIconClass = (iconName) => {
        if (!iconName) return 'fa-solid fa-bullseye';
        if (iconName.startsWith('fa-')) {
            // Check if it already has a style prefix (solid, brands, regular)
            if (iconName.startsWith('fa-solid ') || iconName.startsWith('fa-brands ') || iconName.startsWith('fa-regular ') || iconName.startsWith('fa-light ') || iconName.startsWith('fa-thin ')) {
                return iconName;
            }
            // Check for brand icons that need fa-brands
            const brands = ['linkedin', 'facebook', 'instagram', 'twitter', 'whatsapp', 'github', 'youtube', 'viva-engage', 'microsoft', 'google', 'apple'];
            if (brands.some(brand => iconName.includes(brand))) {
                return `fa-brands ${iconName}`;
            }
            // Default to fa-solid
            return `fa-solid ${iconName}`;
        }
        return iconName;
    };

    // Admin Mission Creation Logic
    const renderAdminMissions = () => {
        const iconSelect = document.getElementById('mission-icon');
        const iconPreview = document.getElementById('mission-icon-preview');

        if (iconSelect && iconPreview) {
            const updateIconPreview = () => {
                const iconValue = iconSelect.value || 'fa-question';
                iconPreview.innerHTML = `<i class="${getIconClass(iconValue)}"></i>`;
            };
            iconSelect.addEventListener('change', updateIconPreview);
            updateIconPreview();
        }
    };

    const missionsCollection = dbAvailable && dbInstance ? dbInstance.collection('custom_missions') : null;
    let sharedMissionCache = [];

    const getMissionData = () => {
        const localMissions = JSON.parse(localStorage.getItem('moura_leite_missions')) || [];
        if (dbAvailable) {
            return sharedMissionCache.length ? sharedMissionCache : localMissions;
        }
        return localMissions;
    };

    const subscribeSharedMissions = () => {
        if (!dbAvailable || !missionsCollection) {
            console.warn('Skipping shared missions subscription because Firestore is unavailable.');
            return;
        }

        missionsCollection.orderBy('createdAt', 'asc').onSnapshot((snapshot) => {
            sharedMissionCache = [];
            snapshot.forEach((doc) => {
                sharedMissionCache.push(doc.data());
            });
            localStorage.setItem('moura_leite_missions', JSON.stringify(sharedMissionCache));
            renderCustomMissions();
            if (typeof renderAdminMissionsList === 'function') renderAdminMissionsList();
            console.log('Shared missions synced from Firestore:', sharedMissionCache.length);
        }, (error) => {
            console.error('Error syncing shared missions:', error);
        });
    };

    // Register mission form listener once
    const registerMissionFormListener = () => {
        const missionForm = document.getElementById('mission-form');
        if (missionForm && !missionForm.hasListener) {
            console.log('Mission form found, registering submit listener');
            missionForm.addEventListener('submit', handleMissionSubmit);
            
            // Icon & Color Real-time Preview Logic
            const iconSelect = document.getElementById('mission-icon');
            const colorInput = document.getElementById('mission-color');
            const previewBox = document.getElementById('mission-icon-preview');
            
            const updatePreview = () => {
                if (!previewBox) return;
                const iconValue = iconSelect.value || 'fa-question';
                const color = colorInput.value || '#1976d2';
                previewBox.innerHTML = `<i class="${getIconClass(iconValue)}" style="color: ${color};"></i>`;
            };
            
            if (iconSelect) iconSelect.addEventListener('change', updatePreview);
            if (colorInput) colorInput.addEventListener('input', updatePreview);
            
            const cancelBtn = document.getElementById('cancel-edit-mission-btn');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    missionForm.reset();
                    delete missionForm.dataset.editingId;
                    const submitBtn = missionForm.querySelector('button[type="submit"]');
                    if (submitBtn) submitBtn.textContent = 'Cadastrar Missão';
                    cancelBtn.classList.add('hidden');
                    updatePreview();
                });
            }

            missionForm.hasListener = true;
        } else if (missionForm) {
            console.log('Mission form listener already registered');
        } else {
            console.warn('Mission form not found');
        }
    };
    
    const seedDefaultMissions = () => {
        if (!localStorage.getItem('moura_leite_seeded_v1')) {
            const defaults = [
                { id: 'sys_checkin', name: 'Check-in Diário', frequency: 'daily', points: 1, validationType: 'button', active: true, surprise: false, description: 'Garanta seu ponto diário apenas acessando o portal.', icon: 'fa-calendar-check', color: '#1976d2', createdAt: new Date().toISOString() },
                { id: 'sys_lunch', name: 'Integração entre Times', frequency: 'weekly', points: 5, validationType: 'photo', active: true, surprise: false, description: 'Almoço com você + 2 pessoas de departamentos diferentes.', icon: 'fa-people-arrows', color: '#f57c00', createdAt: new Date().toISOString() },
                { id: 'sys_reuniao', name: 'Reunião de Integração', frequency: 'weekly', points: 8, validationType: 'photo', active: true, surprise: false, description: 'Participe de um encontro com colegas de outro setor.', icon: 'fa-handshake', color: '#4caf50', createdAt: new Date().toISOString() },
                { id: 'sys_embaixador', name: 'Embaixador Digital', frequency: 'monthly', points: 15, validationType: 'link', active: true, surprise: false, description: 'Compartilhe o novo lançamento da Moura Leite no seu LinkedIn pessoal.', icon: 'fa-brands fa-linkedin', color: '#0077b5', createdAt: new Date().toISOString() },
                { id: 'sys_vivaengage', name: 'Engajamento Viva Engage', frequency: 'monthly', points: 12, validationType: 'link', active: true, surprise: false, description: 'Faça uma postagem no Viva Engage da empresa.', icon: 'fa-share-nodes', color: '#7b2cbf', createdAt: new Date().toISOString() },
                { id: 'sys_jogos', name: 'Dinâmica de Jogos', frequency: 'weekly', points: 20, validationType: 'button', active: true, surprise: false, description: 'Participe da dinâmica de interação dos nossos jogos de tabuleiro durante a semana. Procure o Alex ou a Mariana do RH para alinhar o dia e horário.', icon: 'fa-people-group', color: '#F1863B', createdAt: new Date().toISOString() }
            ];
            
            let missions = JSON.parse(localStorage.getItem('moura_leite_missions')) || [];
            defaults.forEach(d => {
                if (!missions.find(m => m.id === d.id)) missions.push(d);
            });
            localStorage.setItem('moura_leite_missions', JSON.stringify(missions));
            localStorage.setItem('moura_leite_seeded_v1', 'true');
            
            if (dbAvailable && missionsCollection) {
                defaults.forEach(d => missionsCollection.doc(d.id).set(d, {merge: true}));
            }
        }
    };

    
    const renderCustomMissions = () => {
        const questsGrid = document.getElementById('quests-grid');
        if (!questsGrid) return;

        // Remove previously injected custom missions to avoid duplicates
        questsGrid.querySelectorAll('.custom-quest-card').forEach(card => card.remove());

        const missions = getMissionData();
        if (missions.length === 0) {
            return;
        }

        const multiplier = getCurrentMultiplier();
        questsGrid.insertAdjacentHTML('beforeend', missions
            .filter(m => m.active)
            .map(mission => {
                const badgeLabel = mission.frequency === 'daily' ? 'Diário' : mission.frequency === 'weekly' ? 'Semanal' : 'Mensal';
                const showFrequencyBadge = !mission.surprise;
                const surpriseBadge = mission.surprise ? `<div class="quest-surprise-badge"><span class="fire-emoji">🔥</span><span>Surpresa</span></div>` : '';
                const pointValue = Math.floor((mission.points || 0) * multiplier);
                const iconClass = getIconClass(mission.icon);
                const iconColor = mission.color || '#1976d2';
                const expiresAt = mission.expiresAt ? new Date(mission.expiresAt).getTime() : null;
                const isTimed = !!expiresAt;
                const isExpired = isTimed && expiresAt <= Date.now();
                const diff = isTimed && !isExpired ? expiresAt - Date.now() : 0;
                const hours = Math.floor(diff / 3600000);
                const minutes = Math.floor((diff % 3600000) / 60000);
                const seconds = Math.floor((diff % 60000) / 1000);
                const hotLabel = isExpired ? 'Expirada' : (hours > 0 ? `${hours}h ${minutes}m ${seconds}s` : minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`);
                const hotBadge = isTimed ? `<div class="quest-hot-badge" data-expires="${expiresAt}" style="${isExpired ? 'color: #999; text-decoration: line-through;' : ''}"><i class="fa-solid fa-clock"></i> <span>${hotLabel}</span></div>` : '';
                
                // Check if mission was already completed this period
                const lastKey = mission.frequency === 'daily' ? 'lastCustomDaily_' + mission.id
                              : mission.frequency === 'weekly' ? 'lastCustomWeekly_' + mission.id
                              : 'lastCustomMonthly_' + mission.id;
                const dateKey = mission.frequency === 'daily' ? todayStr
                             : mission.frequency === 'weekly' ? currentWeek
                             : currentMonth;
                
                const isCompleted = storedUser[lastKey] === dateKey || 
                                    (mission.id === 'sys_checkin' && storedUser.lastCheckIn === todayStr) ||
                                    (mission.id === 'sys_lunch' && storedUser.lastLunchWeek === currentWeek) ||
                                    (mission.id === 'sys_reuniao' && storedUser.lastReuniaoWeek === currentWeek) ||
                                    (mission.id === 'sys_embaixador' && storedUser.lastLinkedInMonth === currentMonth) ||
                                    (mission.id === 'sys_vivaengage' && storedUser.lastVivaEngageMonth === currentMonth) ||
                                    (mission.id === 'sys_jogos' && storedUser.lastGamesWeek === currentWeek);
                
                let buttonText = isCompleted ? 'Concluído' : 
                    (mission.validationType === 'photo' ? 'Enviar Foto' : 
                     mission.validationType === 'link' ? 'Enviar Link' : 'Validar');
                
                if (isExpired && !isCompleted) buttonText = 'Expirada';
                
                const buttonDisabled = (isCompleted || isExpired) ? 'disabled' : '';
                
                const adminActions = isAdmin ? `
                            <div class="admin-mission-actions">
                                <button class="btn-admin-action" onclick="editMission('${mission.id}')">Editar</button>
                                <button class="btn-admin-action btn-delete" onclick="deleteMission('${mission.id}')">Excluir</button>
                            </div>
                        ` : '';

                return `
                    <div class="quest-card custom-quest-card">
                        ${hotBadge}
                        ${surpriseBadge}
                        ${showFrequencyBadge ? `<div class="quest-badge ${mission.frequency}">${badgeLabel}</div>` : ''}
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

        const dashboardList = document.getElementById('dashboard-missions-list');
        if (dashboardList) {
            dashboardList.innerHTML = '';
            const topMissions = missions.filter(m => m.active && !m.surprise).slice(0, 4);
            dashboardList.insertAdjacentHTML('beforeend', topMissions.map(mission => {
                const iconClass = getIconClass(mission.icon);
                const pointValue = Math.floor((mission.points || 0) * multiplier);
                
                const lastKey = mission.frequency === 'daily' ? 'lastCustomDaily_' + mission.id
                              : mission.frequency === 'weekly' ? 'lastCustomWeekly_' + mission.id
                              : 'lastCustomMonthly_' + mission.id;
                const dateKey = mission.frequency === 'daily' ? todayStr
                             : mission.frequency === 'weekly' ? currentWeek
                             : currentMonth;
                const isCompleted = storedUser[lastKey] === dateKey || 
                                    (mission.id === 'sys_checkin' && storedUser.lastCheckIn === todayStr) ||
                                    (mission.id === 'sys_lunch' && storedUser.lastLunchWeek === currentWeek) ||
                                    (mission.id === 'sys_reuniao' && storedUser.lastReuniaoWeek === currentWeek) ||
                                    (mission.id === 'sys_embaixador' && storedUser.lastLinkedInMonth === currentMonth) ||
                                    (mission.id === 'sys_vivaengage' && storedUser.lastVivaEngageMonth === currentMonth) ||
                                    (mission.id === 'sys_jogos' && storedUser.lastGamesWeek === currentWeek);

                let buttonText = isCompleted ? 'Concluído' : 
                    (mission.validationType === 'photo' ? 'Enviar Foto' : 
                     mission.validationType === 'link' ? 'Enviar Link' : '+'+pointValue+' pts');
                     
                return `
                    <div class="mission-item">
                        <div class="mission-icon" style="background-color: ${mission.color || '#1976d2'}20; color: ${mission.color || '#1976d2'}">
                            <i class="${iconClass}"></i>
                        </div>
                        <div class="mission-details">
                            <h4>${mission.name}</h4>
                            <p>${isCompleted ? 'Missão cumprida!' : mission.description.substring(0, 40) + '...'}</p>
                        </div>
                        <button class="btn-checkin custom-mission-btn" ${isCompleted ? 'disabled' : ''} data-mission-id="${mission.id}" data-mission-name="${mission.name}" data-mission-points="${mission.points}" data-validation-type="${mission.validationType}" data-frequency="${mission.frequency}">
                            ${buttonText}
                        </button>
                    </div>
                `;
            }).join(''));
        }
    };

    const renderAdminMissionsList = () => {
        const body = document.getElementById('admin-missions-list-body');
        if (!body) return;

        const missions = getMissionData();
        if (missions.length === 0) {
            body.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem; color: #999;">Nenhuma missão cadastrada.</td></tr>';
            return;
        }

        body.innerHTML = missions.map(mission => {
            const freqLabel = mission.frequency === 'daily' ? 'Diária' : mission.frequency === 'weekly' ? 'Semanal' : 'Mensal';
            const statusLabel = mission.active ? 'Ativa' : 'Inativa';
            return `
                <tr>
                    <td><strong>${mission.name}</strong></td>
                    <td>${freqLabel}</td>
                    <td>${mission.points} pts</td>
                    <td><span class="status-badge ${mission.active ? 'status-unlocked' : 'status-locked'}">${statusLabel}</span></td>
                    <td>
                        <div style="display:flex; gap:5px; flex-wrap:wrap;">
                            <button onclick="editMission('${mission.id}')" class="btn-buy" style="padding:4px 8px; font-size:10px;">Editar</button>
                            <button onclick="deleteMission('${mission.id}')" class="btn-buy" style="padding:4px 8px; font-size:10px; background:#d32f2f;">Excluir</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    };

    const handleMissionSubmit = async (e) => {
        e.preventDefault();
        
        console.log('Mission form submitted');
        
        const form = document.getElementById('mission-form');
        const editingId = form.dataset.editingId;

        const name = document.getElementById('mission-name').value;
        const frequency = document.getElementById('mission-frequency').value;
        const description = document.getElementById('mission-description').value;
        const points = parseInt(document.getElementById('mission-points').value);
        const icon = document.getElementById('mission-icon').value;
        const color = document.getElementById('mission-color').value;
        const validationType = document.getElementById('mission-validation-type').value;
        const active = document.getElementById('mission-active').checked;
        const surprise = document.getElementById('mission-surprise').checked;
        const durationHours = parseInt(document.getElementById('mission-duration').value, 10);
        const expiresAt = surprise && durationHours > 0 ? new Date(Date.now() + durationHours * 3600000).toISOString() : null;

        try {
            const missions = JSON.parse(localStorage.getItem('moura_leite_missions')) || [];

            if (editingId) {
                // Update existing
                const index = missions.findIndex(m => m.id === editingId);
                if (index !== -1) {
                    const updatedMission = {
                        ...missions[index],
                        name,
                        frequency,
                        description,
                        points,
                        icon,
                        color,
                        validationType,
                        active,
                        surprise,
                        durationHours: surprise ? durationHours : null,
                        expiresAt: surprise && durationHours > 0 && !missions[index].expiresAt ? new Date(Date.now() + durationHours * 3600000).toISOString() : missions[index].expiresAt,
                        updatedAt: new Date().toISOString()
                    };
                    missions[index] = updatedMission;
                    localStorage.setItem('moura_leite_missions', JSON.stringify(missions));

                    if (dbAvailable && missionsCollection) {
                        try {
                            await missionsCollection.doc(editingId).set(updatedMission, { merge: true });
                            console.log('Mission updated in Firestore:', editingId);
                        } catch (firestoreError) {
                            console.error('Firestore update failed:', firestoreError);
                            alert('Missão atualizada localmente, mas não foi possível gravar no Firestore: ' + firestoreError.message);
                        }
                    }
                    alert('Missão atualizada com sucesso!');
                }
                
                delete form.dataset.editingId;
                const submitBtn = form.querySelector('button[type="submit"]');
                if (submitBtn) submitBtn.textContent = 'Cadastrar Missão';
                const cancelBtn = document.getElementById('cancel-edit-mission-btn');
                if (cancelBtn) cancelBtn.classList.add('hidden');

            } else {
                // Create new
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
                    surprise,
                    durationHours: surprise ? durationHours : null,
                    expiresAt,
                    createdAt: new Date().toISOString()
                };

                missions.push(newMission);
                localStorage.setItem('moura_leite_missions', JSON.stringify(missions));

                if (dbAvailable && missionsCollection) {
                    try {
                        await missionsCollection.doc(newMission.id).set(newMission);
                        console.log('Mission persisted to Firestore:', newMission.id);
                    } catch (firestoreError) {
                        console.error('Firestore write failed:', firestoreError);
                        alert('Missão salva localmente, mas não foi possível gravar no Firestore: ' + firestoreError.message);
                    }
                } else {
                    console.warn('Firestore unavailable, mission saved only locally.');
                }
                alert('Missão cadastrada com sucesso!');
            }
            
            // Reset form
            form.reset();
            document.getElementById('mission-color').value = '#1976d2';
            document.getElementById('mission-icon').value = '';
            // Reset preview
            const previewBox = document.getElementById('mission-icon-preview');
            if (previewBox) previewBox.innerHTML = '<i class="fa-solid fa-question" style="color: #1976d2;"></i>';
            renderCustomMissions();
            if (typeof renderAdminMissionsList === 'function') renderAdminMissionsList();
        } catch (error) {
            console.error('Erro ao salvar missão:', error);
            alert('Erro ao salvar missão: ' + error.message);
        }
    };

    window.deleteMission = async (missionId) => {
        if (!confirm('Deseja excluir esta missão permanentemente?')) return;
        const missions = JSON.parse(localStorage.getItem('moura_leite_missions')) || [];
        const updated = missions.filter(m => m.id !== missionId);
        localStorage.setItem('moura_leite_missions', JSON.stringify(updated));
        if (dbAvailable && missionsCollection) {
            try {
                await missionsCollection.doc(missionId).delete();
            } catch (e) {
                console.error('Erro ao excluir missão no Firestore:', e);
            }
        }
        renderCustomMissions();
        if (typeof renderAdminMissionsList === 'function') renderAdminMissionsList();
        alert('Missão excluída com sucesso.');
    };

    window.editMission = async (missionId) => {
        const missions = JSON.parse(localStorage.getItem('moura_leite_missions')) || [];
        const mission = missions.find(m => m.id === missionId);
        if (!mission) return alert('Missão não encontrada.');

        document.getElementById('mission-name').value = mission.name || '';
        document.getElementById('mission-frequency').value = mission.frequency || '';
        document.getElementById('mission-description').value = mission.description || '';
        document.getElementById('mission-points').value = mission.points || '';
        document.getElementById('mission-icon').value = mission.icon || '';
        document.getElementById('mission-color').value = mission.color || '#1976d2';
        document.getElementById('mission-validation-type').value = mission.validationType || '';
        document.getElementById('mission-active').checked = mission.active !== false;
        document.getElementById('mission-surprise').checked = mission.surprise || false;
        document.getElementById('mission-duration').value = mission.durationHours || '';

        // Trigger preview update
        const iconSelect = document.getElementById('mission-icon');
        if (iconSelect) {
            const event = new Event('change');
            iconSelect.dispatchEvent(event);
        }

        // Set editing state
        const form = document.getElementById('mission-form');
        form.dataset.editingId = mission.id;
        
        // Change submit button text
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.textContent = 'Salvar Alterações';
        }
        
        // Show cancel button
        const cancelBtn = document.getElementById('cancel-edit-mission-btn');
        if (cancelBtn) cancelBtn.classList.remove('hidden');

        // Switch to admin missions page and scroll to top
        showPage('admin-missions');
        window.scrollTo(0, 0);
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
            document.getElementById('edit-user-email').value = user.email;
            document.getElementById('edit-user-email-label').innerText = user.email;
            document.getElementById('edit-user-name').value = user.username || '';
            document.getElementById('edit-user-points').value = user.points || 0;
            document.getElementById('edit-user-dept').value = user.dept || '';
            document.getElementById('edit-user-dir').value = user.diretoria || '';
            
            document.getElementById('edit-user-modal').classList.remove('hidden');
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

    // ── Multiplicador Base e Boost de Pontos ────────────────────────────────────
    const _baseMultiplier = () => {
        const currentRankObj = ranks.find((r, i) => userPoints <= r.next) || ranks[ranks.length-1];
        return currentRankObj.multiplier || 1.0;
    };

    const getCurrentMultiplier = () => {
        const base = _baseMultiplier();
        // Check if boost is active using server-synced time
        if (storedUser.boostActiveUntil && getServerTime() < storedUser.boostActiveUntil) {
            return base * 2;
        }
        return base;
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
        if (storedUser.lastCheckIn === todayStr || storedUser['lastCustomDaily_sys_checkin'] === todayStr) completedGoals++;

        // Check Goal 2: Weekly Lunch/Integração entre Times
        if (storedUser.lastLunchWeek === currentWeek || storedUser['lastCustomWeekly_sys_lunch'] === currentWeek) completedGoals++;

        // Check Goal 3: Weekly Reunião de Integração
        if (storedUser.lastReuniaoWeek === currentWeek || storedUser['lastCustomWeekly_sys_reuniao'] === currentWeek) completedGoals++;

        // Check Goal 4: Monthly Embaixador Digital
        if (storedUser.lastLinkedInMonth === currentMonth || storedUser['lastCustomMonthly_sys_embaixador'] === currentMonth) completedGoals++;

        // Check Goal 5: Monthly Viva Engage
        if (storedUser.lastVivaEngageMonth === currentMonth || storedUser['lastCustomMonthly_sys_vivaengage'] === currentMonth) completedGoals++;

        // Check Goal 6: Weekly Tarde dos Jogos
        if (storedUser.lastGamesWeek === currentWeek || storedUser['lastCustomWeekly_sys_jogos'] === currentWeek) completedGoals++;

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

    // Edit User Modal Logic
    const modalEditUser = document.getElementById('edit-user-modal');
    const btnCloseEditUser = document.getElementById('close-edit-user');
    const editUserForm = document.getElementById('edit-user-form');

    if (btnCloseEditUser) {
        btnCloseEditUser.addEventListener('click', () => {
            modalEditUser.classList.add('hidden');
        });
    }

    if (editUserForm) {
        editUserForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('edit-user-email').value;
            const username = document.getElementById('edit-user-name').value;
            const points = parseInt(document.getElementById('edit-user-points').value) || 0;
            const dept = document.getElementById('edit-user-dept').value;
            const diretoria = document.getElementById('edit-user-dir').value;

            let updates = { username, points, dept, diretoria };
            
            try {
                await db.collection("users").doc(email).update(updates);
                
                // Update local session if editing self
                if (email === storedUser.email) {
                    Object.assign(storedUser, updates);
                    localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));
                    updateUIWithUser();
                }

                alert('Usuário atualizado com sucesso!');
                modalEditUser.classList.add('hidden');
            } catch (err) {
                console.error("Erro ao editar usuário:", err);
                alert("Erro ao salvar alterações.");
            }
        });
    }

    window.addEventListener('click', (e) => {
        if (e.target === modalRanks) {
            modalRanks.classList.add('hidden');
        }
        if (e.target === modalEditUser) {
            modalEditUser.classList.add('hidden');
        }
    });



    // Register mission form listener (after all functions are defined)
    registerMissionFormListener();
    setTimeout(registerMissionFormListener, 100);

    // Seed defaults
    seedDefaultMissions();

    // Subscribe to shared missions so all users see created missions
    subscribeSharedMissions();

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
                const now = new Date(getServerTime());
                userPoints -= price;
                updatePointsDisplay();

                const newTransaction = {
                    user: storedUser.username,
                    item: itemName,
                    date: now.toLocaleDateString('pt-BR'),
                    time: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                    status: 'Concluído'
                };

                if (!storedUser.history) storedUser.history = [];
                storedUser.history.unshift(newTransaction);

                const globalHistory = JSON.parse(localStorage.getItem('moura_leite_global_history')) || [];
                globalHistory.unshift(newTransaction);
                localStorage.setItem('moura_leite_global_history', JSON.stringify(globalHistory));

                storedUser.points = userPoints;
                localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));

                const allUsers = JSON.parse(localStorage.getItem('moura_leite_all_users')) || [];
                const userIndex = allUsers.findIndex(u => u.email === storedUser.email);
                if (userIndex !== -1) {
                    allUsers[userIndex].points = userPoints;
                    localStorage.setItem('moura_leite_all_users', JSON.stringify(allUsers));
                }

                // Sync to Firestore
                if (dbAvailable) {
                    db.collection('users').doc(storedUser.email).update({ points: userPoints }).catch(e => console.error('Sync error:', e));
                }

                updateRanking();
                updateUIWithUser();
                addNotification(`Você resgatou: ${itemName}. Retire no RH!`);
                alert(`Sucesso! Você adquiriu: ${itemName}. Retire seu item no RH.`);
            }
        } else {
            alert(`Pontos insuficientes! Você precisa de mais ${price - userPoints} pontos para este item.`);
        }
    };

    // ── Boost de Pontos 2x ─────────────────────────────────────────────────────
    // Uses Firebase server timestamp as single source of truth to prevent cheating.

    const initBoostUI = () => {
        const btn = document.getElementById('boost-btn');
        if (!btn) return;

        const serverNow = new Date(getServerTime());
        const boostMonth = (serverNow.getMonth() + 1) + '-' + serverNow.getFullYear();

        // Check if boost was already bought this month (stored in Firestore)
        if (storedUser.lastBoostMonth === boostMonth) {
            btn.disabled = true;
            btn.textContent = 'Usado ✓';
            return;
        }

        // Check if boost is currently active
        if (storedUser.boostActiveUntil && getServerTime() < storedUser.boostActiveUntil) {
            btn.disabled = true;
            const remaining = Math.ceil((storedUser.boostActiveUntil - getServerTime()) / 3600000);
            btn.textContent = `Ativo (${remaining}h)`;
        }
    };

    window.buyBoost = async function() {
        const price = 50;
        if (userPoints < price) {
            alert(`Pontos insuficientes! Você precisa de mais ${price - userPoints} pontos.`);
            return;
        }

        // Validate via Firestore server timestamp (anti-cheat)
        if (!dbAvailable) {
            alert('É necessário conexão com o servidor para ativar o Boost. Tente novamente.');
            return;
        }

        try {
            // Get current server time from Firestore
            const serverTsDoc = await db.collection('_server_time').doc('sync').get();
            let serverNow;
            if (serverTsDoc.exists && serverTsDoc.data().timestamp) {
                serverNow = serverTsDoc.data().timestamp.toDate();
            } else {
                // Write server timestamp and read back
                await db.collection('_server_time').doc('sync').set({
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });
                const fresh = await db.collection('_server_time').doc('sync').get();
                serverNow = fresh.data().timestamp.toDate();
            }

            const boostMonth = (serverNow.getMonth() + 1) + '-' + serverNow.getFullYear();
            const userDoc = await db.collection('users').doc(storedUser.email).get();
            const userData = userDoc.data() || {};

            // Check monthly limit in Firestore (not localStorage, to prevent manipulation)
            if (userData.lastBoostMonth === boostMonth) {
                alert('Você já usou o Boost este mês. Disponível novamente no próximo mês.');
                const btn = document.getElementById('boost-btn');
                if (btn) { btn.disabled = true; btn.textContent = 'Usado ✓'; }
                return;
            }

            const confirmed = confirm(`Deseja ativar o Boost 2x por ${price} pontos?\nSeus pontos em missões serão dobrados por 24 horas.`);
            if (!confirmed) return;

            // Calculate boost expiry: 24h from server time
            const boostUntilTs = serverNow.getTime() + 86400000; // +24h

            userPoints -= price;
            storedUser.points = userPoints;
            storedUser.lastBoostMonth = boostMonth;
            storedUser.boostActiveUntil = boostUntilTs;

            const now = new Date(serverNow);
            const transaction = {
                user: storedUser.username,
                item: 'Boost de Pontos 2x (24h)',
                date: now.toLocaleDateString('pt-BR'),
                time: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                status: 'Ativo'
            };
            if (!storedUser.history) storedUser.history = [];
            storedUser.history.unshift(transaction);

            const globalHistory = JSON.parse(localStorage.getItem('moura_leite_global_history')) || [];
            globalHistory.unshift(transaction);
            localStorage.setItem('moura_leite_global_history', JSON.stringify(globalHistory));
            localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));

            // Persist to Firestore (authoritative record)
            await db.collection('users').doc(storedUser.email).update({
                points: userPoints,
                lastBoostMonth: boostMonth,
                boostActiveUntil: boostUntilTs
            });

            updatePointsDisplay();
            updateRanking();
            updateUIWithUser();
            initBoostUI();
            addNotification('🚀 Boost 2x ativado! Suas missões valem o dobro por 24h.');
            alert('🚀 Boost ativado! Suas missões valem 2x por 24 horas. Bora completar missões!');

        } catch (err) {
            console.error('Boost error:', err);
            alert('Erro ao ativar o Boost. Tente novamente.');
        }
    };

    // Removed duplicate multiplier logic here

    initBoostUI();

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
            const dirRaw = user.diretoria ? user.diretoria.replace(/^diretoria-/i, '') : '';
            const dirDisplay = dirRaw ? (dirRaw.charAt(0).toUpperCase() + dirRaw.slice(1)) : 'Moura Leite';
            
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
                triggerCelebration();
                logSocialActivity('garantiu o check-in diário! 📅', 'fa-calendar-check');
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

            const isCompleted = storedUser[lastKey] === dateKey || 
                                (missionId === 'sys_checkin' && storedUser.lastCheckIn === todayStr) ||
                                (missionId === 'sys_lunch' && storedUser.lastLunchWeek === currentWeek) ||
                                (missionId === 'sys_reuniao' && storedUser.lastReuniaoWeek === currentWeek) ||
                                (missionId === 'sys_embaixador' && storedUser.lastLinkedInMonth === currentMonth) ||
                                (missionId === 'sys_vivaengage' && storedUser.lastVivaEngageMonth === currentMonth) ||
                                (missionId === 'sys_jogos' && storedUser.lastGamesWeek === currentWeek);

            if (isCompleted) {
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
        if (missionId === 'sys_lunch') storedUser.lunchCount = (storedUser.lunchCount || 0) + 1;
        if (missionId === 'sys_reuniao') storedUser.reuniaoCount = (storedUser.reuniaoCount || 0) + 1;
        if (missionId === 'sys_embaixador') storedUser.linkedInCount = (storedUser.linkedInCount || 0) + 1;
        if (missionId === 'sys_vivaengage') storedUser.vivaEngageCount = (storedUser.vivaEngageCount || 0) + 1;
        
        const transaction = {
            user: storedUser.username,
            item: `Missão: ${missionName}`,
            date: new Date(serverTimestamp).toLocaleDateString('pt-BR'),
            time: new Date(serverTimestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            status: 'Concluído',
            serverTime: serverTimestamp
        };

        if (!storedUser.history) storedUser.history = [];
        storedUser.history.unshift(transaction);
        
        // Global Sync
        const globalHistory = JSON.parse(localStorage.getItem('moura_leite_global_history')) || [];
        globalHistory.unshift(transaction);
        localStorage.setItem('moura_leite_global_history', JSON.stringify(globalHistory));
        
        localStorage.setItem('moura_leite_user', JSON.stringify(storedUser));
        
        // Log successful mission
        logMissionAttempt(storedUser.email, missionId, missionName, true, serverTimestamp);
        
        updatePointsDisplay();
        updateRanking();
        updateUIWithUser();
        renderCustomMissions();
        triggerCelebration();
        logSocialActivity(`completou a missão: ${missionName}! ✅`, 'fa-check-circle');
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
        
        const transaction = {
            user: storedUser.username,
            item: `Missão: ${missionName}`,
            date: new Date(serverTimestamp).toLocaleDateString('pt-BR'),
            time: new Date(serverTimestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            status: 'Validando',
            photo: photoData,
            serverTime: serverTimestamp
        };

        if (!storedUser.history) storedUser.history = [];
        storedUser.history.unshift(transaction);
        
        // Global Sync
        const globalHistory = JSON.parse(localStorage.getItem('moura_leite_global_history')) || [];
        globalHistory.unshift(transaction);
        localStorage.setItem('moura_leite_global_history', JSON.stringify(globalHistory));
        
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
        triggerCelebration();
        logSocialActivity(`enviou evidência para: ${missionName}! 📸`, 'fa-camera');
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
        
        const transaction = {
            user: storedUser.username,
            item: `Missão: ${missionName}`,
            date: new Date(serverTimestamp).toLocaleDateString('pt-BR'),
            time: new Date(serverTimestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            status: 'Validando',
            link: link,
            serverTime: serverTimestamp
        };

        if (!storedUser.history) storedUser.history = [];
        storedUser.history.unshift(transaction);
        
        // Global Sync
        const globalHistory = JSON.parse(localStorage.getItem('moura_leite_global_history')) || [];
        globalHistory.unshift(transaction);
        localStorage.setItem('moura_leite_global_history', JSON.stringify(globalHistory));
        
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
        triggerCelebration();
        logSocialActivity(`completou a missão de link: ${missionName}! 🔗`, 'fa-link');
        addNotification(`${missionName} enviada para validação! +${earned} pts.`);
        alert(`Link enviado! Você ganhou ${earned} pontos por: ${missionName}`);
    };

    window.viewPhoto = (photoData) => {
        const viewer = document.createElement('div');
        viewer.style = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); z-index:9999; display:flex; align-items:center; justify-content:center; cursor:pointer;';
        viewer.innerHTML = `<img src="${photoData}" style="max-width:90%; max-height:90%; border-radius:10px; border: 5px solid white;">`;
        viewer.onclick = () => viewer.remove();
        document.body.appendChild(viewer);
    };

    const startCountdown = () => {
        setInterval(() => {
            const badges = document.querySelectorAll('.quest-hot-badge');
            badges.forEach(badge => {
                const expiresAt = parseInt(badge.getAttribute('data-expires'));
                const diff = expiresAt - Date.now();
                
                if (diff <= 0) {
                    badge.innerHTML = '<span>Expirada</span>';
                    badge.style.background = '#ccc';
                    badge.style.border = '1px solid #999';
                    
                    // Disable the corresponding mission button
                    const card = badge.closest('.quest-card');
                    if (card) {
                        const btn = card.querySelector('.custom-mission-btn');
                        if (btn && !btn.disabled) {
                            btn.disabled = true;
                            btn.innerText = 'Expirada';
                            btn.style.background = '#e0e0e0';
                            btn.style.color = '#999';
                        }
                    }
                    return;
                }

                const hours = Math.floor(diff / 3600000);
                const minutes = Math.floor((diff % 3600000) / 60000);
                const seconds = Math.floor((diff % 60000) / 1000);
                
                let timeStr = "";
                if (hours > 0) timeStr += `${hours}h `;
                if (minutes > 0 || hours > 0) timeStr += `${minutes}m `;
                timeStr += `${seconds}s`;
                
                const span = badge.querySelector('span');
                if (span) span.innerText = timeStr;
            });
        }, 1000);
    };

    saveAndSync();
    updateCheckinUI();
    updateLunchUI();
    updateEmbaixadorUI();
    updateJogosUI();
    updatePointsDisplay();
    updateRanking();
    updateUIWithUser();
    startCountdown();
});
