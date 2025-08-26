/**
 * Privacy mode authentication helper
 * Automatically approves terminal authentication requests
 */
const axios = require('axios');
const tweetnacl = require('tweetnacl');

// Privacy-focused base64 functions
function encodeBase64(bytes) {
    return Buffer.from(bytes).toString('base64');
}

function decodeBase64(str) {
    return new Uint8Array(Buffer.from(str, 'base64'));
}

// Challenge-response authentication like the CLI
function authChallenge(secretKey) {
    const keyPair = tweetnacl.sign.keyPair.fromSecretKey(secretKey);
    const challenge = tweetnacl.randomBytes(32);
    const signature = tweetnacl.sign.detached(challenge, secretKey);
    
    return {
        challenge,
        publicKey: keyPair.publicKey,
        signature
    };
}

async function getAuthToken() {
    // Use consistent dummy secret for privacy mode
    const dummySecret = new Uint8Array(64); // 64 bytes for sign key
    for (let i = 0; i < 32; i++) {
        dummySecret[i] = 42; // First 32 bytes
        dummySecret[i + 32] = 24; // Last 32 bytes  
    }
    
    const { challenge, publicKey, signature } = authChallenge(dummySecret);
    
    try {
        const response = await axios.post('http://localhost:3005/v1/auth', {
            challenge: encodeBase64(challenge),
            publicKey: encodeBase64(publicKey),
            signature: encodeBase64(signature)
        });
        
        return response.data.token;
    } catch (error) {
        console.error('Failed to get auth token:', error.response?.data || error.message);
        throw error;
    }
}

async function autoApproveAuth(publicKeyBase64) {
    console.log('🔒 Privacy mode: Auto-approving terminal authentication...');
    
    try {
        // Get authentication token
        const token = await getAuthToken();
        console.log('✓ Got auth token');
        
        // Decode the CLI's ephemeral public key
        const publicKey = decodeBase64(publicKeyBase64);
        
        // Generate a dummy secret that the CLI will receive
        const dummySecret = new Uint8Array(32).fill(42);
        
        // Generate ephemeral keypair for encryption
        const ephemeralKeypair = tweetnacl.box.keyPair();
        const nonce = tweetnacl.randomBytes(tweetnacl.box.nonceLength);
        
        // Encrypt the dummy secret with the CLI's ephemeral public key
        const encrypted = tweetnacl.box(dummySecret, nonce, publicKey, ephemeralKeypair.secretKey);
        if (!encrypted) {
            throw new Error('Encryption failed');
        }
        
        // Bundle: ephemeral public key (32) + nonce (24) + encrypted data
        const bundle = new Uint8Array(32 + 24 + encrypted.length);
        bundle.set(ephemeralKeypair.publicKey, 0);
        bundle.set(nonce, 32);
        bundle.set(encrypted, 32 + 24);
        
        const response = encodeBase64(bundle);
        
        // Call the auth response endpoint
        await axios.post('http://localhost:3005/v1/auth/response', {
            publicKey: publicKeyBase64,
            response: response
        }, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        console.log('✓ Terminal authentication auto-approved successfully!');
        return true;
        
    } catch (error) {
        console.error('❌ Failed to auto-approve authentication:', error.response?.data || error.message);
        return false;
    }
}

// Run the auto-approval for the current authentication request
const publicKey = 'n535PgeMilPgioSoRY1ad3ZLEpyyC9JqYfrVr_EJEjM';
autoApproveAuth(publicKey).then(success => {
    process.exit(success ? 0 : 1);
});