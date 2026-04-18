
/**
 * Script de prueba para validar la lógica de mapeo de parámetros de Meta Onboarding
 */

function solveParams(query) {
    const q = query;
    const queryWabaId = (q.wabaId || q.waba_id || q.whatsapp_business_account_id || q.shared_waba_id);
    const queryPhoneId = (q.phoneId || q.phone_id || q.phone_number_id || q.phoneNumberId);
    const queryProjectId = (q.projectId || q.railwayProjectId || q.project_id);

    return {
        waba: queryWabaId,
        phone: queryPhoneId,
        project: queryProjectId
    };
}

const tests = [
    {
        name: "Standard Meta/DuskCodes Params",
        input: { waba_id: "W1", phone_number_id: "P1", railwayProjectId: "PROJ1" },
        expected: { waba: "W1", phone: "P1", project: "PROJ1" }
    },
    {
        name: "Alternative Meta Params",
        input: { whatsapp_business_account_id: "W2", phone_id: "P2", project_id: "PROJ2" },
        expected: { waba: "W2", phone: "P2", project: "PROJ2" }
    },
    {
        name: "Legacy CamelCase Params",
        input: { wabaId: "W3", phoneId: "P3", projectId: "PROJ3" },
        expected: { waba: "W3", phone: "P3", project: "PROJ3" }
    },
    {
        name: "Shared WABA Case",
        input: { shared_waba_id: "W4", phoneNumberId: "P4", railwayProjectId: "PROJ4" },
        expected: { waba: "W4", phone: "P4", project: "PROJ4" }
    }
];

console.log("🚀 Iniciando pruebas de mapeo de parámetros...");
tests.forEach(t => {
    const result = solveParams(t.input);
    const success = JSON.stringify(result) === JSON.stringify(t.expected);
    console.log(`${success ? '✅' : '❌'} ${t.name}: ${success ? 'PASSED' : 'FAILED'}`);
    if (!success) console.log(`   EXPECTED: ${JSON.stringify(t.expected)} | GOT: ${JSON.stringify(result)}`);
});
