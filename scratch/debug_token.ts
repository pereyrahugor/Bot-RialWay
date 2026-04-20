import axios from 'axios';

async function debugToken() {
    const token = 'EAAVOfFTMb0YBRDO0zZCM59M3QultdkfgQj5JZBVLJZAWQKEyIrZCrL13vvfM3uPldGhVNoDLu2XTnthE1fOxOOcjmbmSfDmEGDkjs0ayIIZBpzxvY2oEDze4JaVSkAQ70lUM1oh9Bly8en0qMPnZCaH5ZBwpo7Cf6b2f5me06FpbZBQbt1D3Rma2EPII5xhupMOqhD0n4BGnLIOBZBSY9fSgxilFnJqYQafZAF9gTM6vxwQ5KnG8GZA0pBjLg7avXUgcER5ljlp8mExZCr2MiBXvm7L7xLJ7vmFsE6fD3c23';
    // App Token: AppID|AppSecret
    const appToken = '1493670789148486|362b2ec20c00bdf51336fd165ad47160'; 
    
    try {
        console.log(`📡 Depurando token...`);
        const response = await axios.get(`https://graph.facebook.com/v22.0/debug_token`, {
            params: {
                input_token: token,
                access_token: appToken
            }
        });
        console.log('✅ Info del Token:', JSON.stringify(response.data.data, null, 2));
    } catch (error) {
        console.error('❌ Error debug:', error.response?.data || error.message);
    }
}

debugToken();
