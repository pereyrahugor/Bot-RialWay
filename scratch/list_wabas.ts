import axios from 'axios';

async function listWabas() {
    const token = 'EAAVOfFTMb0YBRDO0zZCM59M3QultdkfgQj5JZBVLJZAWQKEyIrZCrL13vvfM3uPldGhVNoDLu2XTnthE1fOxOOcjmbmSfDmEGDkjs0ayIIZBpzxvY2oEDze4JaVSkAQ70lUM1oh9Bly8en0qMPnZCaH5ZBwpo7Cf6b2f5me06FpbZBQbt1D3Rma2EPII5xhupMOqhD0n4BGnLIOBZBSY9fSgxilFnJqYQafZAF9gTM6vxwQ5KnG8GZA0pBjLg7avXUgcER5ljlp8mExZCr2MiBXvm7L7xLJ7vmFsE6fD3c23';
    
    try {
        console.log(`📡 Listando WABAs del Business 845474567943547...`);
        const response = await axios.get(`https://graph.facebook.com/v22.0/845474567943547/whatsapp_business_accounts`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log('✅ WABAs encontradas:', JSON.stringify(response.data.data, null, 2));
    } catch (error) {
        console.error('❌ Error list:', error.response?.data || error.message);
    }
}

listWabas();
