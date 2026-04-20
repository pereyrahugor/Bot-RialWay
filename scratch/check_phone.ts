import axios from 'axios';

async function checkPhone() {
    const phoneId = '547699465095440';
    const token = 'EAAVOfFTMb0YBRDO0zZCM59M3QultdkfgQj5JZBVLJZAWQKEyIrZCrL13vvfM3uPldGhVNoDLu2XTnthE1fOxOOcjmbmSfDmEGDkjs0ayIIZBpzxvY2oEDze4JaVSkAQ70lUM1oh9Bly8en0qMPnZCaH5ZBwpo7Cf6b2f5me06FpbZBQbt1D3Rma2EPII5xhupMOqhD0n4BGnLIOBZBSY9fSgxilFnJqYQafZAF9gTM6vxwQ5KnG8GZA0pBjLg7avXUgcER5ljlp8mExZCr2MiBXvm7L7xLJ7vmFsE6fD3c23';
    
    try {
        console.log(`📡 Consultando teléfono ${phoneId}...`);
        const response = await axios.get(`https://graph.facebook.com/v22.0/${phoneId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log('✅ Teléfono encontrado:', JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error('❌ Error consultando teléfono:', error.response?.data || error.message);
    }
}

checkPhone();
