
import { HistoryHandler } from '../src/utils/historyHandler';
import dotenv from 'dotenv';
dotenv.config();

async function test() {
    console.log('--- TEST TICKETS (ABIERTOS) ---');
    const open = await HistoryHandler.listTickets(50, 0); // Default: Abiertos
    console.log('Cant Abiertos:', open.length);
    open.forEach(t => console.log(`- ${t.titulo} (${t.estado})` ));

    console.log('\n--- TEST TICKETS (CERRADOS) ---');
    const closed = await HistoryHandler.listTickets(50, 0, 'Cerrado');
    console.log('Cant Cerrados:', closed.length);
    closed.forEach(t => console.log(`- ${t.titulo} (${t.estado})` ));
}

test();
