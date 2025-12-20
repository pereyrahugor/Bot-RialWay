document.addEventListener('DOMContentLoaded', () => {
    console.log('Variables panel loaded');
    
    const cancelBtn = document.getElementById('cancel-btn');
    const variablesForm = document.getElementById('variables-form');

    // Botón Cancelar: vuelve al dashboard
    cancelBtn.addEventListener('click', () => {
        window.location.href = '/dashboard';
    });

    // Manejo del formulario (lógica de guardado pendiente)
    variablesForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        alert('Lógica de actualización pendiente de implementar.');
    });
});
