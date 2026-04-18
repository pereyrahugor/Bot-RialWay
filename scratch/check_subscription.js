
import axios from 'axios';

const token = "EAAVOfFTMb0YBRDO0zZCM59M3QultdkfgQj5JZBVLJZAWQKEyIrZCrL13vvfM3uPldGhVNoDLu2XTnthE1fOxOOcjmbmSfDmEGDkjs0ayIIZBpzxvY2oEDze4JaVSkAQ70lUM1oh9Bly8en0qMPnZCaH5ZBwpo7Cf6b2f5me06FpbZBQbt1D3Rma2EPII5xhupMOqhD0n4BGnLIOBZBSY9fSgxilFnJqYQafZAF9gTM6vxwQ5KnG8GZA0pBjLg7avXUgcER5ljlp8mExZCr2MiBXvm7L7xLJ7vmFsE6fD3c23";
const wabaId = "1508169090167020";

async function checkSub() {
    try {
        console.log(`Checking subscription for WABA ${wabaId}...`);
        const res = await axios.get(`https://graph.facebook.com/v22.0/${wabaId}/subscribed_apps`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log("Response:", JSON.stringify(res.data, null, 2));
    } catch (e) {
        console.error("Error:", e.response?.data || e.message);
    }
}

checkSub();
