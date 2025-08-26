/**
 * Direct database authentication approval for privacy mode
 * Bypasses all API layers and directly updates the database
 */
const { PrismaClient } = require('@prisma/client');
const tweetnacl = require('tweetnacl');

const prisma = new PrismaClient();

function encodeBase64(bytes) {
    return Buffer.from(bytes).toString('base64');
}

function decodeBase64(str) {
    return new Uint8Array(Buffer.from(str, 'base64'));
}

function encodeHex(bytes) {
    return Buffer.from(bytes).toString('hex').toUpperCase();
}

async function directAuthApproval() {
    console.log('🔒 Privacy mode: Direct database authentication approval...');
    
    try {
        // The CLI's ephemeral public key in base64url format
        const publicKeyBase64 = 'n535PgeMilPgioSoRY1ad3ZLEpyyC9JqYfrVr_EJEjM';
        
        // Convert base64url to base64 (replace URL-safe chars)
        const publicKeyBase64Standard = publicKeyBase64
            .replace(/-/g, '+')
            .replace(/_/g, '/');
        
        // Add padding if needed
        const padding = '='.repeat((4 - publicKeyBase64Standard.length % 4) % 4);
        const publicKeyBase64Padded = publicKeyBase64Standard + padding;
        
        const publicKey = decodeBase64(publicKeyBase64Padded);
        const publicKeyHex = encodeHex(publicKey);
        
        console.log(`Looking for auth request with public key hex: ${publicKeyHex}`);
        
        // Find the pending auth request
        const authRequest = await prisma.terminalAuthRequest.findUnique({
            where: { publicKey: publicKeyHex }
        });
        
        if (!authRequest) {
            console.log('❌ No pending auth request found');
            return false;
        }
        
        if (authRequest.response) {
            console.log('✓ Already authorized');
            return true;
        }
        
        // Create or find privacy-mode user
        const privacyUser = await prisma.account.upsert({
            where: { publicKey: 'privacy-mode-local-user-hex' },
            update: { updatedAt: new Date() },
            create: { publicKey: 'privacy-mode-local-user-hex' }
        });
        
        console.log(`Using privacy user ID: ${privacyUser.id}`);
        
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
        
        const responseData = encodeBase64(bundle);
        
        // Update the auth request directly in the database
        await prisma.terminalAuthRequest.update({
            where: { id: authRequest.id },
            data: { 
                response: responseData,
                responseAccountId: privacyUser.id
            }
        });
        
        console.log('✅ Terminal authentication auto-approved via direct database access!');
        console.log('The CLI should now complete authentication successfully.');
        return true;
        
    } catch (error) {
        console.error('❌ Direct auth approval failed:', error);
        return false;
    } finally {
        await prisma.$disconnect();
    }
}

// Run the direct database auth approval
directAuthApproval().then(success => {
    process.exit(success ? 0 : 1);
});