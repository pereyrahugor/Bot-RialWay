import axios from 'axios';

async function subscribeWaba() {
    const wabaId = '845474567943547';
    const token = 'EAAVOfFTMb0YBRDO0zZCM59M3QultdkfgQj5JZBVLJZAWQKEyIrZCrL13vvfM3uPldGhVNoDLu2XTnthE1fOxOOcjmbmSfDmEGDkjs0ayIIZBpzxvY2oEDze4JaVSkAQ70lUM1oh9Bly8en0qMPnZCaH5ZBwpo7Cf6b2f5me06FpbZBQbt1D3Rma2EPII5xhupMOqhD0n4BGnLIOBZBSY9fSgxilFnJqYQafZAF9gTM6vxwQ5KnG8GZA0pBjLg7avXUgcER5ljlp8mExZCr2MiBXvm7L7xLJ7vmFsE6fD3c23';
    
    try {
        console.log(`📡 Suscribiendo WABA ${wabaId}...`);
        const response = await axios.post(`https://graph.facebook.com/v22.0/${wabaId}/subscribed_apps?subscribed_fields=messages,smb_message_echoes`, 
            {}, 
            { 
                headers: { 'Authorization': `Bearer ${token}` }
            }
        );
        console.log('✅ Respuesta de Meta:', JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error('❌ Error suscripción:', error.response?.data || error.message);
    }
}

subscribeWaba();
