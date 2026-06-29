// usuarios.view.js - Vista independiente para la gestión y creación de usuarios
window.usuariosView = {
    title: 'Gestión de Usuarios - ' + (window.BOT_NAME || 'Backoffice'),

    getHTML() {
        return `
        <!-- Contenido principal -->
        <div id="main-config-content" style="display:flex; opacity:1; flex:1; overflow:auto; flex-direction:column;">
            <main class="crm-main-container relative" style="z-index:10; max-width:none; padding:0;">

                <div class="kanban-header animate-fade">
                    <div class="header-info">
                        <h1><i class="fas fa-users-cog kanban-header-icon" style="color:#0099FF;"></i> Gestion de Equipo y Usuarios</h1>
                        <p>Registra nuevos sub-usuarios y administra el acceso de tu equipo al sistema en tiempo real</p>
                    </div>
                </div>

                <div style="padding: 1rem 1.25rem 8rem 1.25rem;">
                    <!-- Seccion 1: Registrar Nuevo Sub-Usuario -->
                    <div class="variables-grid">
                        <div class="variable-group">
                            <h3>NOMBRE COMPLETO</h3>
                            <p class="description">Nombre completo del usuario.</p>
                            <input type="text" id="new-user-name" placeholder="Nombre completo">
                        </div>
                        <div class="variable-group">
                            <h3>USUARIO</h3>
                            <p class="description">Nombre de usuario para iniciar sesion.</p>
                            <input type="text" id="new-user-user" placeholder="Ej: juan_vendedor">
                        </div>
                        <div class="variable-group">
                            <h3>CONTRASEÑA</h3>
                            <p class="description">Contrasena de acceso al sistema.</p>
                            <input type="password" id="new-user-pass" autocomplete="new-password" placeholder="Contraseña">
                        </div>
                        <div class="variable-group">
                            <h3>ROL</h3>
                            <p class="description">Nivel de acceso en la plataforma.</p>
                            <div class="csd-wrap csd-sm">
                                <select id="new-user-role" hidden>
                                    <option value="subuser">Vendedor / Operador (Limitado)</option>
                                    <option value="admin">Administrador (Total)</option>
                                </select>
                                <button class="csd-btn" type="button" onclick="_csdToggle(this)">
                                    <span class="csd-label">Vendedor / Operador (Limitado)</span>
                                    <i class="fas fa-chevron-down csd-chevron"></i>
                                </button>
                                <div class="csd-menu">
                                    <button class="csd-item selected" type="button" data-val="subuser" onclick="_csdSelect(this,'subuser')">Vendedor / Operador (Limitado)</button>
                                    <button class="csd-item" type="button" data-val="admin" onclick="_csdSelect(this,'admin')">Administrador (Total)</button>
                                </div>
                            </div>
                        </div>
                        <div class="col-span-full" style="grid-column:1/-1; margin-top: 10px;">
                            <button type="button" class="btn px-8 py-3 w-full justify-center" style="background:linear-gradient(135deg,#10b981,#059669); box-shadow:0 4px 12px rgba(16,185,129,0.3);" onclick="window.saveNewUser()">
                                <i class="fas fa-user-plus" style="margin-right:8px;"></i> Crear Usuario
                            </button>
                        </div>
                    </div>

                    <!-- Seccion 2: Usuarios en el Equipo -->
                    <div class="variables-grid" style="margin-top: 2.5rem;">
                        <div class="section-header">
                            <h2><i class="fas fa-users"></i> Usuarios en el Equipo</h2>
                        </div>
                        <div class="variable-group" style="grid-column:1/-1; background:var(--bg-header); border:1.5px solid var(--border); border-radius:14px; padding:0; overflow:hidden;">
                            <div id="team-list-container">
                                <div style="display:flex;align-items:center;justify-content:center;height:120px;width:100%;">
                                    <i class="fas fa-circle-notch fa-spin" style="font-size:2rem;color:var(--accent);"></i>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

            </main>
        </div>

        <!-- Modal para editar usuario -->
        <div id="edit-user-modal" class="modal-overlay" style="display: none; z-index: 99999;">
            <div class="modal-content" style="max-width: 440px;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 1rem; margin-bottom: 1.5rem;">
                    <h2 style="font-size: 1.25rem; font-weight: 600; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
                        <i class="fas fa-user-edit" style="color: #0099FF;"></i> Editar Usuario
                    </h2>
                    <button onclick="window.closeEditUserModal()" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 1.25rem;">&times;</button>
                </div>
                <input type="hidden" id="edit-user-id">
                <div style="margin-bottom: 1.25rem;">
                    <label style="display: block; font-size: 0.75rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 0.5rem;">NUEVO NOMBRE DE USUARIO</label>
                    <input type="text" id="edit-user-username" class="input-field" placeholder="Nombre de usuario">
                </div>
                <div style="margin-bottom: 1.75rem;">
                    <label style="display: block; font-size: 0.75rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 0.5rem;">NUEVA CONTRASEÑA (Opcional)</label>
                    <input type="password" id="edit-user-password" class="input-field" placeholder="Dejar en blanco para no cambiar">
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 1rem;">
                    <button type="button" class="btn px-6 py-2.5" style="background: var(--bg-header); border: 1px solid var(--border); color: var(--text-main);" onclick="window.closeEditUserModal()">Cancelar</button>
                    <button type="button" class="btn px-6 py-2.5" style="background: linear-gradient(135deg, #0099FF, #0077CC); box-shadow: 0 4px 12px rgba(0,153,255,0.3); color: white;" onclick="window.saveEditUser()">Guardar Cambios</button>
                </div>
            </div>
        </div>
        `;
    },

    async init() {
        if (typeof window.loadGlobalTeam === 'function') {
            await window.loadGlobalTeam();
        }
    },

    destroy() { }
};
