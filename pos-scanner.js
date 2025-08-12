class POSBarcodeScanner {
    constructor() {
        this.isScanning = false;
        this.cart = JSON.parse(localStorage.getItem('pos_cart')) || [];
        this.cartTotal = 0;
        this.scanCount = 0;
        
        this.updateCartDisplay();
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Handle successful barcode detection
        document.addEventListener('barcodeDetected', (event) => {
            this.handleBarcodeDetected(event.detail.code);
        });
        
        // Handle page visibility changes
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.isScanning) {
                this.stopScanning();
            }
        });
    }
    
    async requestCameraPermission() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { 
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                } 
            });
            
            // Stop the stream immediately, we just needed permission
            stream.getTracks().forEach(track => track.stop());
            
            document.getElementById('permissions-prompt').classList.add('hidden');
            this.updateStatus('Camera permission granted! Ready to scan.', 'success');
            return true;
        } catch (error) {
            console.error('Camera permission denied:', error);
            this.updateStatus('Camera access denied. Please enable camera permissions.', 'error');
            document.getElementById('permissions-prompt').classList.remove('hidden');
            return false;
        }
    }
    
    async startScanning() {
        if (this.isScanning) return;
        
        try {
            // Check camera permission first
            const hasPermission = await this.checkCameraPermission();
            if (!hasPermission) {
                const granted = await this.requestCameraPermission();
                if (!granted) return;
            }
            
            this.updateStatus('Initializing camera...', 'info');
            
            await this.initializeQuagga();
            this.isScanning = true;
            
            document.getElementById('start-btn').disabled = true;
            document.getElementById('stop-btn').disabled = false;
            document.getElementById('scanning-line').style.display = 'block';
            
            this.updateStatus('🔍 Scanning... Point camera at barcode', 'success');
            
        } catch (error) {
            console.error('Failed to start scanning:', error);
            this.updateStatus('Failed to start camera: ' + error.message, 'error');
            this.isScanning = false;
        }
    }
    
    stopScanning() {
        if (!this.isScanning) return;
        
        try {
            Quagga.stop();
            this.isScanning = false;
            
            document.getElementById('start-btn').disabled = false;
            document.getElementById('stop-btn').disabled = true;
            document.getElementById('scanning-line').style.display = 'none';
            
            this.updateStatus('Scanning stopped', 'info');
            
        } catch (error) {
            console.error('Error stopping scanner:', error);
        }
    }
    
    async checkCameraPermission() {
        try {
            const permissions = await navigator.permissions.query({name: 'camera'});
            return permissions.state === 'granted';
        } catch (error) {
            // Fallback for browsers that don't support permissions API
            return true;
        }
    }
    
    initializeQuagga() {
        return new Promise((resolve, reject) => {
            Quagga.init({
                inputStream: {
                    name: "Live",
                    type: "LiveStream",
                    target: document.querySelector('#scanner'),
                    constraints: {
                        width: 480,
                        height: 320,
                        facingMode: "environment"
                    }
                },
                decoder: {
                    readers: [
                        "code_128_reader",
                        "ean_reader", 
                        "ean_8_reader",
                        "code_39_reader",
                        "code_39_vin_reader",
                        "codabar_reader",
                        "upc_reader",
                        "upc_e_reader",
                        "i2of5_reader"
                    ],
                    debug: {
                        showCanvas: false,
                        showPatches: false,
                        showFoundPatches: false,
                        showSkeleton: false,
                        showLabels: false,
                        showPatchLabels: false,
                        showRemainingPatchLabels: false,
                        boxFromPatches: {
                            showTransformed: false,
                            showTransformedBox: false,
                            showBB: false
                        }
                    }
                },
                locate: true,
                locator: {
                    patchSize: "medium",
                    halfSample: true
                },
                numOfWorkers: 2,
                frequency: 10
            }, (err) => {
                if (err) {
                    console.error('Quagga initialization failed:', err);
                    reject(err);
                    return;
                }
                
                console.log("Quagga initialization finished. Ready to start");
                Quagga.start();
                
                // Set up barcode detection handler
                Quagga.onDetected(this.handleQuaggaDetected.bind(this));
                
                resolve();
            });
        });
    }
    
    handleQuaggaDetected(data) {
        const code = data.codeResult.code;
        const confidence = data.codeResult.confidence || 0;
        
        // Only process high-confidence detections to reduce false positives
        if (confidence > 75) {
            // Dispatch custom event for barcode detection
            const event = new CustomEvent('barcodeDetected', {
                detail: { code, confidence }
            });
            document.dispatchEvent(event);
        }
    }
    
    async handleBarcodeDetected(barcode) {
        if (!barcode || barcode.length === 0) return;
        
        // Prevent rapid duplicate scans
        const now = Date.now();
        if (this.lastScanTime && (now - this.lastScanTime) < 2000) {
            return;
        }
        this.lastScanTime = now;
        
        this.scanCount++;
        this.updateStatus('📦 Barcode detected: ' + barcode, 'success');
        
        try {
            // Look up product information
            const product = await this.lookupProduct(barcode);
            
            // Add to cart
            this.addToCart(product);
            
            // Provide haptic feedback if available
            if ('vibrate' in navigator) {
                navigator.vibrate(100);
            }
            
            // Audio feedback
            this.playBeep();
            
        } catch (error) {
            console.error('Error processing barcode:', error);
            this.updateStatus('Error processing barcode: ' + error.message, 'error');
        }
    }
    
    async lookupProduct(barcode) {
        this.updateStatus('Looking up product information...', 'info');
        
        try {
            // First try configured product lookup endpoint
            const response = await fetch('/api/products/lookup', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ barcode })
            });
            
            if (response.ok) {
                const data = await response.json();
                return {
                    id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    barcode: barcode,
                    name: data.name || `Product ${barcode}`,
                    price: parseFloat(data.price) || 0.00,
                    quantity: 1,
                    category: data.category || 'General',
                    brand: data.brand || 'Unknown',
                    image_url: data.image_url || null,
                    scanned_at: new Date().toISOString()
                };
            }
        } catch (error) {
            console.warn('Product lookup failed:', error);
        }
        
        // Fallback to basic product data
        return {
            id: `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            barcode: barcode,
            name: `Product ${barcode}`,
            price: 0.00,
            quantity: 1,
            category: 'General',
            brand: 'Unknown',
            image_url: null,
            scanned_at: new Date().toISOString()
        };
    }
    
    addToCart(product) {
        // Check if product already exists in cart
        const existingIndex = this.cart.findIndex(item => item.barcode === product.barcode);
        
        if (existingIndex >= 0) {
            // Update quantity
            this.cart[existingIndex].quantity += 1;
            this.cart[existingIndex].total = this.cart[existingIndex].quantity * this.cart[existingIndex].price;
        } else {
            // Add new item
            product.total = product.quantity * product.price;
            this.cart.push(product);
        }
        
        this.saveCart();
        this.updateCartDisplay();
        
        this.updateStatus(`Added "${product.name}" to cart`, 'success');
        
        // Send to cart endpoint if configured
        this.syncWithCartAPI(product);
    }
    
    async syncWithCartAPI(product) {
        try {
            await fetch('/api/cart/add', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(product)
            });
        } catch (error) {
            console.warn('Failed to sync with cart API:', error);
        }
    }
    
    updateCartDisplay() {
        const cartItemsEl = document.getElementById('cart-items');
        const cartTotalEl = document.getElementById('cart-total');
        
        if (this.cart.length === 0) {
            cartItemsEl.innerHTML = '<p style="text-align: center; color: #6b7280; font-style: italic;">Cart is empty</p>';
            this.cartTotal = 0;
        } else {
            cartItemsEl.innerHTML = this.cart.map(item => `
                <div class="cart-item">
                    <div class="item-info">
                        <div class="item-name">${item.name}</div>
                        <div class="item-details">
                            ${item.barcode} • Qty: ${item.quantity} • ${item.brand}
                        </div>
                    </div>
                    <div class="item-price">$${item.total.toFixed(2)}</div>
                </div>
            `).join('');
            
            this.cartTotal = this.cart.reduce((total, item) => total + item.total, 0);
        }
        
        cartTotalEl.textContent = `Total: $${this.cartTotal.toFixed(2)}`;
    }
    
    clearCart() {
        this.cart = [];
        this.saveCart();
        this.updateCartDisplay();
        this.updateStatus('Cart cleared', 'info');
    }
    
    saveCart() {
        localStorage.setItem('pos_cart', JSON.stringify(this.cart));
    }
    
    updateStatus(message, type = 'info') {
        const statusEl = document.getElementById('status');
        statusEl.textContent = message;
        statusEl.className = `status ${type}`;
    }
    
    playBeep() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.value = 800;
            oscillator.type = 'square';
            
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.1);
        } catch (error) {
            console.warn('Audio feedback not available:', error);
        }
    }
}

// Global functions for HTML onclick handlers
let scanner;

function startScanning() {
    if (scanner) {
        scanner.startScanning();
    }
}

function stopScanning() {
    if (scanner) {
        scanner.stopScanning();
    }
}

function clearCart() {
    if (scanner) {
        scanner.clearCart();
    }
}

function requestCameraPermission() {
    if (scanner) {
        scanner.requestCameraPermission();
    }
}

// Initialize scanner when page loads
document.addEventListener('DOMContentLoaded', function() {
    scanner = new POSBarcodeScanner();
    
    // Auto-request camera permission on mobile devices
    if (/Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
        setTimeout(() => {
            scanner.requestCameraPermission();
        }, 1000);
    }
});