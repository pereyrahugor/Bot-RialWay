
import dotenv from 'dotenv';
dotenv.config();
import { HistoryHandler } from './src/utils/historyHandler';

async function test() {
    console.log('Testing listTickets...');
    const tickets = await HistoryHandler.listTickets();
    console.log('Tickets returned:', tickets.length);
    console.log('First ticket:', JSON.stringify(tickets[0], null, 2));
}

test();
