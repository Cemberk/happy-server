/**
 * Test CLI authentication flow
 * Simulates what the CLI should be doing to complete authentication
 */
const axios = require('axios');

function decodeBase64(str) {
    return new Uint8Array(Buffer.from(str, 'base64'));
}

function encodeBase64Url(bytes) {
    return Buffer.from(bytes)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

async function testCliAuth() {
    console.log('🧪 Testing CLI authentication flow...');
    
    // The CLI's ephemeral public key in base64url format (what CLI sends)
    const publicKeyBase64Url = 'n535PgeMilPgioSoRY1ad3ZLEpyyC9JqYfrVr_EJEjM';
    
    try {
        console.log(`Sending auth request with publicKey: ${publicKeyBase64Url.substring(0, 20)}...`);
        
        const response = await axios.post('http://localhost:3005/v1/auth/request', {
            publicKey: publicKeyBase64Url
        });
        
        console.log('✅ Server Response:');
        console.log(`   State: ${response.data.state}`);
        
        if (response.data.state === 'authorized') {
            console.log(`   Token: ${response.data.token.substring(0, 50)}...`);
            console.log(`   Response length: ${response.data.response.length} characters`);
            console.log('✅ CLI should now be able to complete authentication!');
            
            // Test decryption (simulate what CLI does)
            try {
                const encryptedBundle = decodeBase64(response.data.response);
                console.log(`   Encrypted bundle size: ${encryptedBundle.length} bytes`);
                console.log('✅ Response format appears correct for CLI decryption');
            } catch (err) {
                console.log('❌ Error decoding response:', err.message);
            }
            
        } else if (response.data.state === 'requested') {
            console.log('⏳ Authentication still pending - need to approve');
        } else {
            console.log('❓ Unknown state:', response.data.state);
        }
        
    } catch (error) {
        console.error('❌ CLI authentication test failed:');
        console.error(`   Status: ${error.response?.status}`);
        console.error(`   Error: ${error.response?.data?.error || error.message}`);
    }
}

testCliAuth().catch(console.error);