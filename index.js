require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const JWT_SECRET = process.env.JWT_SECRET || 'velora_fallback_secret_for_dev_only';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/velora';

// MongoDB Connection (optimized for serverless)
let cachedDb = null;
async function connectToDatabase() {
    if (cachedDb) return cachedDb;
    const client = await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    cachedDb = client;
    return client;
}

// ---------------------------------------------------------
// DATABASE SCHEMAS & MODELS
// ---------------------------------------------------------
const userSchema = new mongoose.Schema({
    name: { type: String, required: true }, email: { type: String, required: true, unique: true },
    phone: { type: String, required: true }, password: { type: String, required: true },
    role: { type: String, enum: ['customer', 'admin'], default: 'customer' },
    address: { district: String, area: String, details: String }
}, { timestamps: true });

const productSchema = new mongoose.Schema({
    name: { type: String, required: true }, slug: { type: String, required: true, unique: true },
    sku: { type: String, required: true, unique: true }, description: String,
    price: { type: Number, required: true }, originalPrice: { type: Number },
    stock: { type: Number, required: true, default: 0 }, category: String,
    images: [String], active: { type: Boolean, default: true }, featured: { type: Boolean, default: false }
}, { timestamps: true });

const categorySchema = new mongoose.Schema({ name: String, slug: { type: String, unique: true }, active: { type: Boolean, default: true }});
const bannerSchema = new mongoose.Schema({ title: String, subtitle: String, image: String, link: String, startDate: Date, endDate: Date, active: { type: Boolean, default: true }});
const campaignSchema = new mongoose.Schema({ name: String, slug: String, description: String, image: String, startDate: Date, endDate: Date, active: { type: Boolean, default: true }});
const discountSchema = new mongoose.Schema({ name: String, type: { type: String, enum: ['percentage', 'fixed'] }, value: Number, minOrder: { type: Number, default: 0 }, startDate: Date, endDate: Date, active: { type: Boolean, default: true }});
const couponSchema = new mongoose.Schema({ code: { type: String, unique: true, uppercase: true }, type: { type: String, enum: ['percentage', 'fixed'] }, value: Number, minOrder: { type: Number, default: 0 }, maxDiscount: Number, usageLimit: { type: Number, default: 100 }, usedCount: { type: Number, default: 0 }, startDate: Date, endDate: Date, active: { type: Boolean, default: true }});

const orderSchema = new mongoose.Schema({
    orderNumber: { type: String, required: true, unique: true }, user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    customerName: String, phone: String, address: { district: String, area: String, details: String },
    items: [{ product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }, name: String, price: Number, quantity: Number }],
    subtotal: Number, discountAmount: Number, deliveryFee: Number, total: Number, couponApplied: String,
    paymentMethod: { type: String, default: 'COD' }, paymentStatus: { type: String, default: 'Unpaid' },
    status: { type: String, enum: ['Pending Confirmation', 'Confirmed', 'Processing', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled'], default: 'Pending Confirmation' }
}, { timestamps: true });

const db = {
    User: mongoose.models.User || mongoose.model('User', userSchema),
    Product: mongoose.models.Product || mongoose.model('Product', productSchema),
    Category: mongoose.models.Category || mongoose.model('Category', categorySchema),
    Banner: mongoose.models.Banner || mongoose.model('Banner', bannerSchema),
    Campaign: mongoose.models.Campaign || mongoose.model('Campaign', campaignSchema),
    Discount: mongoose.models.Discount || mongoose.model('Discount', discountSchema),
    Coupon: mongoose.models.Coupon || mongoose.model('Coupon', couponSchema),
    Order: mongoose.models.Order || mongoose.model('Order', orderSchema)
};

// ---------------------------------------------------------
// AUTHENTICATION & MIDDLEWARE
// ---------------------------------------------------------
const verifyToken = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) { req.user = null; return next(); }
    try { req.user = jwt.verify(token, JWT_SECRET); } catch (e) { req.user = null; }
    next();
};
const requireAuth = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Unauthorized' });
const isAdmin = (req, res, next) => req.user && req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Forbidden' });

app.use(verifyToken);
app.use(async (req, res, next) => { await connectToDatabase(); next(); });

// Secure Bootstrap for first Admin
app.post('/api/setup', async (req, res) => {
    const count = await db.User.countDocuments({ role: 'admin' });
    if (count > 0) return res.status(403).json({ error: 'Admin already exists' });
    const { name, email, phone, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.User.create({ name, email, phone, password: hashedPassword, role: 'admin' });
    res.json({ message: 'Admin created successfully. Please login at /login' });
});

// Admin Integration
app.use('/admin', require('./admin.js')(db, { verifyToken: requireAuth, isAdmin }));

// ---------------------------------------------------------
// HTML UI LAYOUT ENGINE (Frontend)
// ---------------------------------------------------------
const renderLayout = (title, content, req) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} | VELORA</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'); body { font-family: 'Inter', sans-serif; }</style>
</head>
<body class="bg-slate-50 text-slate-800 flex flex-col min-h-screen">
    <!-- Announcement Bar -->
    <div class="bg-slate-900 text-white text-xs text-center py-2">Premium Quality Products | Nationwide Cash on Delivery 🇧🇩</div>
    <!-- Header -->
    <header class="bg-white shadow-sm sticky top-0 z-50">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
            <a href="/" class="text-2xl font-bold tracking-widest text-slate-900">VELORA</a>
            <div class="hidden md:flex flex-1 mx-12">
                <input type="text" placeholder="Search premium products..." class="w-full bg-slate-100 border-none rounded-full px-6 py-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm">
            </div>
            <div class="flex items-center space-x-6">
                ${req.user ? `
                    ${req.user.role === 'admin' ? `<a href="/admin" class="text-sm font-medium hover:text-blue-600">Admin</a>` : ''}
                    <a href="/account" class="text-sm font-medium hover:text-blue-600">Account</a>
                ` : `<a href="/login" class="text-sm font-medium hover:text-blue-600">Sign In</a>`}
                <a href="/cart" class="relative hover:text-blue-600">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"></path></svg>
                    <span id="cart-count" class="absolute -top-2 -right-2 bg-blue-600 text-white text-[10px] font-bold h-4 w-4 rounded-full flex items-center justify-center">0</span>
                </a>
            </div>
        </div>
    </header>
    <!-- Main Content -->
    <main class="flex-grow">${content}</main>
    <!-- Footer -->
    <footer class="bg-white border-t border-slate-200 pt-12 pb-8 mt-12">
        <div class="max-w-7xl mx-auto px-4 grid grid-cols-1 md:grid-cols-4 gap-8 mb-8 text-sm">
            <div><h3 class="font-bold text-lg tracking-widest mb-4">VELORA</h3><p class="text-slate-500">Elevating your lifestyle with premium essentials across Bangladesh.</p></div>
            <div><h4 class="font-bold mb-4">Shop</h4><ul class="space-y-2 text-slate-500"><li><a href="/products">All Products</a></li><li><a href="/track-order">Track Order</a></li></ul></div>
            <div><h4 class="font-bold mb-4">Support</h4><ul class="space-y-2 text-slate-500"><li>Contact Us</li><li>Delivery Information</li><li>Return Policy</li></ul></div>
            <div><h4 class="font-bold mb-4">Stay Connected</h4><p class="text-slate-500">Dhaka, Bangladesh<br>support@velora.com.bd</p></div>
        </div>
        <div class="text-center text-slate-400 text-xs border-t border-slate-100 pt-8">© ${new Date().getFullYear()} VELORA. All rights reserved.</div>
    </footer>
    <script>
        // Global Cart Logic
        const updateCartCount = () => {
            const cart = JSON.parse(localStorage.getItem('velora_cart') || '[]');
            document.getElementById('cart-count').innerText = cart.reduce((acc, item) => acc + item.qty, 0);
        };
        updateCartCount();
        const addToCart = (id, name, price, img) => {
            let cart = JSON.parse(localStorage.getItem('velora_cart') || '[]');
            const existing = cart.find(i => i.id === id);
            if(existing) existing.qty += 1; else cart.push({id, name, price, img, qty: 1});
            localStorage.setItem('velora_cart', JSON.stringify(cart));
            updateCartCount();
            alert('Added to cart!');
        };
    </script>
</body>
</html>
`;

// ---------------------------------------------------------
// PUBLIC API & AUTHENTICATION ENDPOINTS
// ---------------------------------------------------------
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, phone, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await db.User.create({ name, email, phone, password: hashedPassword });
        const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' }).json({ success: true });
    } catch (err) { res.status(400).json({ error: 'Registration failed. Email might be in use.' }); }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await db.User.findOne({ email });
        if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Invalid credentials' });
        const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' }).json({ success: true, role: user.role });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('token').json({ success: true });
});

// Server-side Cart & Discount Computation
const computeCartTotals = async (cartItems, couponCode = null) => {
    const productIds = cartItems.map(i => i.id);
    const products = await db.Product.find({ _id: { $in: productIds }, active: true });
    const now = new Date();
    
    // Fetch active generic discounts
    const activeDiscounts = await db.Discount.find({ active: true, startDate: { $lte: now }, endDate: { $gte: now } });
    
    let subtotal = 0;
    const validatedItems = [];

    for (let item of cartItems) {
        const product = products.find(p => p._id.toString() === item.id);
        if (!product || product.stock < item.qty) throw new Error(`Invalid or out of stock: ${product ? product.name : 'Item'}`);
        
        let effectivePrice = product.price;
        // Apply best generic discount
        for (let d of activeDiscounts) {
            let dPrice = effectivePrice;
            if (d.type === 'percentage') dPrice -= (dPrice * d.value / 100);
            else if (d.type === 'fixed') dPrice -= d.value;
            if (dPrice < effectivePrice && dPrice >= 0) effectivePrice = dPrice;
        }

        const lineTotal = effectivePrice * item.qty;
        subtotal += lineTotal;
        validatedItems.push({ product: product._id, name: product.name, price: effectivePrice, quantity: item.qty });
    }

    let discountAmount = 0;
    let appliedCoupon = null;

    if (couponCode) {
        const coupon = await db.Coupon.findOne({ code: couponCode.toUpperCase(), active: true, startDate: { $lte: now }, endDate: { $gte: now } });
        if (!coupon) throw new Error('Invalid or expired coupon');
        if (coupon.usedCount >= coupon.usageLimit) throw new Error('Coupon usage limit reached');
        if (subtotal < coupon.minOrder) throw new Error(`Minimum order of ৳${coupon.minOrder} required for this coupon`);
        
        if (coupon.type === 'percentage') {
            let calcDisc = subtotal * (coupon.value / 100);
            discountAmount = coupon.maxDiscount ? Math.min(calcDisc, coupon.maxDiscount) : calcDisc;
        } else {
            discountAmount = Math.min(coupon.value, subtotal);
        }
        appliedCoupon = coupon;
    }

    const deliveryFee = 100; // Flat fee logic for simplicity
    const total = Math.max(0, subtotal - discountAmount) + deliveryFee;

    return { subtotal, discountAmount, deliveryFee, total, validatedItems, appliedCoupon };
};

app.post('/api/cart/validate', async (req, res) => {
    try {
        const { items, coupon } = req.body;
        if (!items || items.length === 0) return res.status(400).json({ error: 'Cart is empty' });
        const calc = await computeCartTotals(items, coupon);
        res.json({ subtotal: calc.subtotal, discount: calc.discountAmount, delivery: calc.deliveryFee, total: calc.total });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/orders', async (req, res) => {
    try {
        const { items, customerName, phone, district, area, details, couponCode } = req.body;
        const calc = await computeCartTotals(items, couponCode);
        
        // Generate Unique Order Number VEL-YYYYMMDD-XXXXXX
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const randomStr = Math.floor(100000 + Math.random() * 900000);
        const orderNumber = `VEL-${dateStr}-${randomStr}`;

        const order = await db.Order.create({
            orderNumber, user: req.user ? req.user.id : null,
            customerName, phone, address: { district, area, details },
            items: calc.validatedItems,
            subtotal: calc.subtotal, discountAmount: calc.discountAmount, deliveryFee: calc.deliveryFee, total: calc.total,
            couponApplied: calc.appliedCoupon ? calc.appliedCoupon.code : null,
            paymentMethod: 'COD', paymentStatus: 'Unpaid', status: 'Pending Confirmation'
        });

        // Deduct stock and increment coupon usage
        for (let item of calc.validatedItems) await db.Product.findByIdAndUpdate(item.product, { $inc: { stock: -item.quantity } });
        if (calc.appliedCoupon) await db.Coupon.findByIdAndUpdate(calc.appliedCoupon._id, { $inc: { usedCount: 1 } });

        res.json({ success: true, orderNumber: order.orderNumber });
    } catch (err) { res.status(400).json({ error: err.message }); }
});

// ---------------------------------------------------------
// FRONTEND ROUTES (SSR HTML)
// ---------------------------------------------------------

// Homepage
app.get('/', async (req, res) => {
    const now = new Date();
    const [banners, campaigns, featuredProducts, newArrivals] = await Promise.all([
        db.Banner.find({ active: true, startDate: { $lte: now }, endDate: { $gte: now } }),
        db.Campaign.find({ active: true, startDate: { $lte: now }, endDate: { $gte: now } }),
        db.Product.find({ active: true, featured: true }).limit(8),
        db.Product.find({ active: true }).sort({ createdAt: -1 }).limit(4)
    ]);

    const productCard = (p) => `
        <div class="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden hover:shadow-md transition group">
            <a href="/product/${p.slug}" class="block relative h-64 overflow-hidden bg-slate-50">
                <img src="${p.images[0] || 'https://via.placeholder.com/400'}" class="w-full h-full object-cover group-hover:scale-105 transition duration-500" alt="${p.name}">
                ${p.originalPrice > p.price ? `<span class="absolute top-3 left-3 bg-red-500 text-white text-[10px] font-bold px-2 py-1 rounded">SALE</span>` : ''}
            </a>
            <div class="p-5">
                <a href="/product/${p.slug}"><h3 class="font-medium text-slate-800 mb-1 truncate">${p.name}</h3></a>
                <div class="flex justify-between items-center mt-3">
                    <div>
                        <span class="font-bold text-slate-900 text-lg">৳${p.price}</span>
                        ${p.originalPrice > p.price ? `<span class="text-xs text-slate-400 line-through ml-1">৳${p.originalPrice}</span>` : ''}
                    </div>
                    <button onclick="addToCart('${p._id}', '${p.name.replace(/'/g,"")}', ${p.price}, '${p.images[0] || ''}')" class="bg-slate-900 text-white w-8 h-8 rounded-full flex items-center justify-center hover:bg-blue-600 transition">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                    </button>
                </div>
            </div>
        </div>
    `;

    const html = `
        ${banners.length > 0 ? `
            <div class="relative w-full h-[50vh] bg-slate-100 overflow-hidden">
                <img src="${banners[0].image || 'https://via.placeholder.com/1200x500'}" class="w-full h-full object-cover opacity-80" alt="${banners[0].title}">
                <div class="absolute inset-0 bg-gradient-to-r from-slate-900/70 to-transparent flex items-center">
                    <div class="max-w-7xl mx-auto px-8 w-full">
                        <h2 class="text-white text-5xl font-bold mb-4 tracking-tight max-w-xl">${banners[0].title}</h2>
                        <p class="text-slate-200 text-lg mb-8 max-w-md">${banners[0].subtitle}</p>
                        <a href="${banners[0].link || '/products'}" class="bg-white text-slate-900 px-8 py-3 rounded-full font-semibold hover:bg-blue-600 hover:text-white transition">Shop Now</a>
                    </div>
                </div>
            </div>
        ` : ''}
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
            ${campaigns.length > 0 ? `
                <div class="mb-16">
                    <h2 class="text-2xl font-bold mb-6 text-slate-900">Active Campaigns</h2>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                        ${campaigns.map(c => `
                            <div class="relative rounded-2xl overflow-hidden h-48 group border border-slate-200">
                                <img src="${c.image || 'https://via.placeholder.com/800x400'}" class="w-full h-full object-cover group-hover:scale-105 transition duration-500">
                                <div class="absolute inset-0 bg-black/40 flex flex-col justify-center px-8">
                                    <h3 class="text-white text-2xl font-bold">${c.name}</h3>
                                    <p class="text-slate-200 text-sm mt-2">${c.description}</p>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
            
            <div class="flex justify-between items-end mb-8">
                <h2 class="text-2xl font-bold text-slate-900 tracking-tight">Featured Collection</h2>
                <a href="/products" class="text-sm font-medium text-blue-600 hover:underline">View All</a>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-6 mb-16">${featuredProducts.map(productCard).join('')}</div>

            <h2 class="text-2xl font-bold text-slate-900 mb-8 tracking-tight">New Arrivals</h2>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-6">${newArrivals.map(productCard).join('')}</div>
            
            <!-- Store Benefits -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-8 mt-24 border-t border-slate-200 pt-16 text-center">
                <div><div class="text-3xl mb-4">🚚</div><h4 class="font-bold text-slate-800">Cash on Delivery</h4><p class="text-sm text-slate-500 mt-2">Pay securely at your doorstep.</p></div>
                <div><div class="text-3xl mb-4">✨</div><h4 class="font-bold text-slate-800">Premium Quality</h4><p class="text-sm text-slate-500 mt-2">Carefully curated for excellence.</p></div>
                <div><div class="text-3xl mb-4">💬</div><h4 class="font-bold text-slate-800">24/7 Support</h4><p class="text-sm text-slate-500 mt-2">Dedicated customer service.</p></div>
            </div>
        </div>
    `;
    res.send(renderLayout('Home', html, req));
});

// Product Listing
app.get('/products', async (req, res) => {
    const products = await db.Product.find({ active: true }).sort({ createdAt: -1 });
    const html = `
        <div class="max-w-7xl mx-auto px-4 py-12">
            <h1 class="text-3xl font-bold mb-8">All Products</h1>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
                ${products.map(p => `
                    <div class="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden hover:shadow-md transition">
                        <a href="/product/${p.slug}" class="block h-64 bg-slate-50"><img src="${p.images[0] || 'https://via.placeholder.com/400'}" class="w-full h-full object-cover" alt="${p.name}"></a>
                        <div class="p-5">
                            <a href="/product/${p.slug}"><h3 class="font-medium text-slate-800 truncate">${p.name}</h3></a>
                            <div class="flex justify-between items-center mt-3">
                                <span class="font-bold text-slate-900">৳${p.price}</span>
                                <button onclick="addToCart('${p._id}', '${p.name.replace(/'/g,"")}', ${p.price}, '${p.images[0]||''}')" class="text-blue-600 font-medium text-sm hover:underline">Add</button>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    res.send(renderLayout('Products', html, req));
});

// Product Details
app.get('/product/:slug', async (req, res) => {
    const p = await db.Product.findOne({ slug: req.params.slug, active: true });
    if (!p) return res.status(404).send('Product Not Found');
    const html = `
        <div class="max-w-7xl mx-auto px-4 py-16 grid grid-cols-1 md:grid-cols-2 gap-12">
            <div class="bg-slate-50 rounded-2xl overflow-hidden shadow-inner border border-slate-100">
                <img src="${p.images[0] || 'https://via.placeholder.com/600'}" class="w-full h-auto object-cover" alt="${p.name}">
            </div>
            <div class="flex flex-col justify-center">
                <div class="text-sm text-blue-600 font-semibold uppercase tracking-wider mb-2">${p.category || 'General'}</div>
                <h1 class="text-4xl font-bold text-slate-900 mb-4">${p.name}</h1>
                <div class="text-3xl font-bold text-slate-900 mb-6">৳${p.price} ${p.originalPrice > p.price ? `<span class="text-lg text-slate-400 line-through ml-2">৳${p.originalPrice}</span>` : ''}</div>
                <p class="text-slate-600 mb-8 leading-relaxed">${p.description || 'Premium quality product.'}</p>
                <div class="text-sm mb-6 ${p.stock > 0 ? 'text-green-600' : 'text-red-500'} font-medium">${p.stock > 0 ? `In Stock (${p.stock} units)` : 'Out of Stock'}</div>
                ${p.stock > 0 ? `
                    <button onclick="addToCart('${p._id}', '${p.name.replace(/'/g,"")}', ${p.price}, '${p.images[0]||''}')" class="bg-blue-600 text-white px-8 py-4 rounded-full font-bold text-lg hover:bg-slate-900 transition w-full md:w-auto text-center shadow-lg shadow-blue-600/30">Add to Cart</button>
                ` : `<button disabled class="bg-slate-300 text-slate-500 px-8 py-4 rounded-full font-bold text-lg w-full md:w-auto cursor-not-allowed">Out of Stock</button>`}
                <div class="mt-12 pt-8 border-t border-slate-100 space-y-4 text-sm text-slate-500">
                    <p>✓ 100% Authentic Product</p><p>✓ Cash on Delivery Available</p><p>✓ 7 Days Easy Return</p>
                </div>
            </div>
        </div>
    `;
    res.send(renderLayout(p.name, html, req));
});

// Cart & Checkout Logic (Client-Side Rendering Mixed)
app.get('/cart', (req, res) => {
    const html = `
        <div class="max-w-4xl mx-auto px-4 py-12">
            <h1 class="text-3xl font-bold mb-8 text-slate-900">Checkout</h1>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-12">
                <div class="md:col-span-2 space-y-8">
                    <!-- Cart Items -->
                    <div id="cart-container" class="bg-white rounded-2xl shadow-sm border border-slate-100 p-6"></div>
                    
                    <!-- Delivery Form -->
                    <div class="bg-white rounded-2xl shadow-sm border border-slate-100 p-6" id="delivery-form" style="display:none;">
                        <h2 class="text-xl font-bold mb-6 border-b pb-2">Delivery Details</h2>
                        <form id="checkout-form" class="space-y-4">
                            <div><label class="block text-sm font-semibold mb-1">Full Name</label><input type="text" id="c_name" required class="w-full border border-slate-300 rounded-lg p-3 bg-slate-50 focus:bg-white outline-none focus:ring-2 focus:ring-blue-500"></div>
                            <div><label class="block text-sm font-semibold mb-1">Phone Number</label><input type="tel" id="c_phone" required class="w-full border border-slate-300 rounded-lg p-3 bg-slate-50 focus:bg-white outline-none focus:ring-2 focus:ring-blue-500"></div>
                            <div class="grid grid-cols-2 gap-4">
                                <div><label class="block text-sm font-semibold mb-1">District / City</label><input type="text" id="c_district" required class="w-full border border-slate-300 rounded-lg p-3 bg-slate-50 focus:bg-white outline-none focus:ring-2 focus:ring-blue-500"></div>
                                <div><label class="block text-sm font-semibold mb-1">Area</label><input type="text" id="c_area" required class="w-full border border-slate-300 rounded-lg p-3 bg-slate-50 focus:bg-white outline-none focus:ring-2 focus:ring-blue-500"></div>
                            </div>
                            <div><label class="block text-sm font-semibold mb-1">Detailed Address</label><textarea id="c_details" required class="w-full border border-slate-300 rounded-lg p-3 bg-slate-50 focus:bg-white outline-none focus:ring-2 focus:ring-blue-500" rows="3"></textarea></div>
                            <div class="pt-4"><button type="submit" class="w-full bg-slate-900 text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-600 transition shadow-lg shadow-slate-900/20">Confirm Order (Cash on Delivery)</button></div>
                        </form>
                    </div>
                </div>
                
                <!-- Order Summary -->
                <div class="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 h-fit sticky top-24" id="summary-container">
                    <h2 class="text-xl font-bold mb-6 border-b pb-2">Summary</h2>
                    <div class="space-y-3 text-slate-600 text-sm mb-6">
                        <div class="flex justify-between"><span>Subtotal</span><span id="sum-sub" class="font-medium text-slate-900">৳0</span></div>
                        <div class="flex justify-between text-green-600"><span>Discount</span><span id="sum-disc">-৳0</span></div>
                        <div class="flex justify-between"><span>Delivery</span><span id="sum-del">৳100</span></div>
                        <div class="border-t pt-3 flex justify-between font-bold text-lg text-slate-900"><span>Total</span><span id="sum-tot">৳0</span></div>
                    </div>
                    <div class="flex space-x-2 mb-6">
                        <input type="text" id="coupon-code" placeholder="Coupon Code" class="flex-1 border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 uppercase">
                        <button onclick="applyCoupon()" class="bg-slate-200 hover:bg-slate-300 text-slate-800 px-4 py-2 rounded-lg text-sm font-medium transition">Apply</button>
                    </div>
                </div>
            </div>
        </div>
        <script>
            let currentCoupon = null;
            const renderCart = () => {
                const cart = JSON.parse(localStorage.getItem('velora_cart') || '[]');
                const container = document.getElementById('cart-container');
                if(cart.length === 0) {
                    container.innerHTML = '<p class="text-center text-slate-500 py-12">Your cart is empty.</p>';
                    document.getElementById('delivery-form').style.display = 'none';
                    document.getElementById('summary-container').style.display = 'none';
                    return;
                }
                document.getElementById('delivery-form').style.display = 'block';
                document.getElementById('summary-container').style.display = 'block';
                
                container.innerHTML = cart.map((item, index) => \`
                    <div class="flex items-center space-x-4 py-4 \${index !== cart.length-1 ? 'border-b border-slate-100' : ''}">
                        <img src="\${item.img || 'https://via.placeholder.com/100'}" class="w-16 h-16 rounded-lg object-cover bg-slate-50">
                        <div class="flex-1">
                            <h4 class="font-semibold text-slate-800">\${item.name}</h4>
                            <div class="text-slate-500 text-sm">৳\${item.price} x \${item.qty}</div>
                        </div>
                        <div class="font-bold text-slate-900">৳\${item.price * item.qty}</div>
                        <button onclick="removeCartItem('\${item.id}')" class="text-red-500 text-sm hover:underline">Remove</button>
                    </div>
                \`).join('');
                validateCartOnServer();
            };
            
            const removeCartItem = (id) => {
                let cart = JSON.parse(localStorage.getItem('velora_cart') || '[]');
                cart = cart.filter(i => i.id !== id);
                localStorage.setItem('velora_cart', JSON.stringify(cart));
                updateCartCount(); renderCart();
            };

            const validateCartOnServer = async () => {
                const cart = JSON.parse(localStorage.getItem('velora_cart') || '[]');
                if(cart.length === 0) return;
                try {
                    const res = await fetch('/api/cart/validate', {
                        method: 'POST', headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ items: cart, coupon: currentCoupon })
                    });
                    const data = await res.json();
                    if(!res.ok) throw new Error(data.error);
                    document.getElementById('sum-sub').innerText = '৳' + data.subtotal;
                    document.getElementById('sum-disc').innerText = '-৳' + data.discount;
                    document.getElementById('sum-del').innerText = '৳' + data.delivery;
                    document.getElementById('sum-tot').innerText = '৳' + data.total;
                } catch(e) { alert(e.message); currentCoupon = null; document.getElementById('coupon-code').value = ''; validateCartOnServer(); }
            };

            const applyCoupon = () => {
                const code = document.getElementById('coupon-code').value.trim();
                if(!code) return;
                currentCoupon = code;
                validateCartOnServer();
            };

            document.getElementById('checkout-form').addEventListener('submit', async (e) => {
                e.preventDefault();
                const cart = JSON.parse(localStorage.getItem('velora_cart') || '[]');
                const payload = {
                    items: cart, couponCode: currentCoupon,
                    customerName: document.getElementById('c_name').value,
                    phone: document.getElementById('c_phone').value,
                    district: document.getElementById('c_district').value,
                    area: document.getElementById('c_area').value,
                    details: document.getElementById('c_details').value
                };
                const btn = e.target.querySelector('button');
                btn.disabled = true; btn.innerText = 'Processing...';
                try {
                    const res = await fetch('/api/orders', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
                    const data = await res.json();
                    if(!res.ok) throw new Error(data.error);
                    localStorage.removeItem('velora_cart');
                    window.location.href = '/order-success?order=' + data.orderNumber;
                } catch(err) { alert(err.message); btn.disabled = false; btn.innerText = 'Confirm Order'; }
            });

            renderCart();
        </script>
    `;
    res.send(renderLayout('Checkout', html, req));
});

app.get('/order-success', (req, res) => {
    const html = `
        <div class="max-w-2xl mx-auto px-4 py-24 text-center">
            <div class="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
            </div>
            <h1 class="text-4xl font-bold text-slate-900 mb-4">Order Confirmed!</h1>
            <p class="text-slate-600 mb-8 text-lg">Thank you for shopping with VELORA. Your order has been placed successfully and will be delivered via Cash on Delivery.</p>
            <div class="bg-slate-50 rounded-xl border border-slate-200 p-6 inline-block mb-8 shadow-sm">
                <p class="text-sm text-slate-500 font-medium mb-1">Your Order Number</p>
                <p class="text-2xl font-bold tracking-wider text-slate-900">${req.query.order || 'Unknown'}</p>
            </div>
            <div>
                <a href="/track-order?order=${req.query.order}" class="inline-block bg-blue-600 text-white px-8 py-3 rounded-full font-semibold hover:bg-slate-900 transition mr-4 shadow-lg shadow-blue-600/30">Track Order</a>
                <a href="/products" class="inline-block bg-white text-slate-900 border border-slate-300 px-8 py-3 rounded-full font-semibold hover:bg-slate-50 transition">Continue Shopping</a>
            </div>
        </div>
    `;
    res.send(renderLayout('Order Success', html, req));
});

// Order Tracking
app.get('/track-order', async (req, res) => {
    let orderHtml = '';
    if (req.query.order) {
        const order = await db.Order.findOne({ orderNumber: req.query.order }).populate('items.product');
        if (!order) {
            orderHtml = `<div class="bg-red-50 text-red-600 p-4 rounded-lg mt-6 border border-red-100 text-center">Order not found. Please check the number.</div>`;
        } else {
            const statuses = ['Pending Confirmation', 'Confirmed', 'Processing', 'Shipped', 'Out for Delivery', 'Delivered'];
            const currentIndex = statuses.indexOf(order.status);
            const isCancelled = order.status === 'Cancelled';
            
            orderHtml = `
                <div class="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 mt-8">
                    <div class="flex justify-between items-start border-b pb-6 mb-6">
                        <div>
                            <h2 class="text-2xl font-bold text-slate-900">${order.orderNumber}</h2>
                            <p class="text-slate-500 text-sm mt-1">Placed on ${new Date(order.createdAt).toLocaleDateString()}</p>
                        </div>
                        <div class="text-right">
                            <div class="text-2xl font-bold text-slate-900">৳${order.total}</div>
                            <div class="text-sm font-medium ${order.paymentStatus === 'Paid' ? 'text-green-600' : 'text-orange-500'}">${order.paymentMethod} - ${order.paymentStatus}</div>
                        </div>
                    </div>
                    
                    ${!isCancelled ? `
                        <div class="relative pt-8 pb-12">
                            <div class="overflow-hidden h-2 mb-4 text-xs flex rounded bg-slate-100">
                                <div style="width: ${(currentIndex / (statuses.length - 1)) * 100}%" class="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-blue-600 transition-all duration-500"></div>
                            </div>
                            <div class="flex justify-between text-xs font-medium text-slate-500 px-1">
                                ${statuses.map((s, i) => `<span class="${i <= currentIndex ? 'text-blue-600 font-bold' : ''}">${s}</span>`).join('')}
                            </div>
                        </div>
                    ` : `<div class="bg-red-100 text-red-700 p-4 rounded-lg font-bold text-center mb-8">This order has been cancelled.</div>`}
                    
                    <h3 class="font-bold text-lg mb-4">Items Ordered</h3>
                    <div class="space-y-4">
                        ${order.items.map(i => `
                            <div class="flex justify-between items-center bg-slate-50 p-4 rounded-lg border border-slate-100">
                                <div><div class="font-semibold text-slate-800">${i.name}</div><div class="text-sm text-slate-500">Qty: ${i.quantity}</div></div>
                                <div class="font-bold text-slate-900">৳${i.price * i.quantity}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
    }

    const html = `
        <div class="max-w-3xl mx-auto px-4 py-16">
            <h1 class="text-3xl font-bold text-slate-900 text-center mb-8">Track Your Order</h1>
            <form action="/track-order" method="GET" class="flex space-x-2 max-w-lg mx-auto">
                <input type="text" name="order" value="${req.query.order || ''}" placeholder="e.g. VEL-20261021-123456" required class="flex-1 border border-slate-300 rounded-full px-6 py-3 bg-white outline-none focus:ring-2 focus:ring-blue-500 shadow-sm text-center font-medium tracking-wide">
                <button type="submit" class="bg-slate-900 text-white px-8 py-3 rounded-full font-semibold hover:bg-blue-600 transition shadow-lg">Track</button>
            </form>
            ${orderHtml}
        </div>
    `;
    res.send(renderLayout('Track Order', html, req));
});

// Authentication UI
app.get('/login', (req, res) => {
    if (req.user) return res.redirect('/account');
    const html = `
        <div class="max-w-md mx-auto mt-20 bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
            <h2 class="text-2xl font-bold text-center mb-6 text-slate-900">Sign In to VELORA</h2>
            <form id="login-form" class="space-y-4">
                <div><label class="block text-sm font-semibold mb-1">Email</label><input type="email" id="l_email" required class="w-full border rounded-lg p-3 outline-none focus:border-blue-500 bg-slate-50 focus:bg-white"></div>
                <div><label class="block text-sm font-semibold mb-1">Password</label><input type="password" id="l_pass" required class="w-full border rounded-lg p-3 outline-none focus:border-blue-500 bg-slate-50 focus:bg-white"></div>
                <button type="submit" class="w-full bg-blue-600 text-white py-3 rounded-xl font-bold shadow-lg shadow-blue-600/30 hover:bg-slate-900 transition mt-4">Sign In</button>
            </form>
            <p class="text-center mt-6 text-sm text-slate-500">Don't have an account? <a href="/register" class="text-blue-600 font-bold hover:underline">Register</a></p>
            <script>
                document.getElementById('login-form').onsubmit = async (e) => {
                    e.preventDefault();
                    try {
                        const res = await fetch('/api/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({email: document.getElementById('l_email').value, password: document.getElementById('l_pass').value}) });
                        const data = await res.json();
                        if(!res.ok) throw new Error(data.error);
                        window.location.href = data.role === 'admin' ? '/admin' : '/account';
                    } catch(err) { alert(err.message); }
                };
            </script>
        </div>
    `;
    res.send(renderLayout('Login', html, req));
});

app.get('/register', (req, res) => {
    if (req.user) return res.redirect('/account');
    const html = `
        <div class="max-w-md mx-auto mt-20 bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
            <h2 class="text-2xl font-bold text-center mb-6 text-slate-900">Create Account</h2>
            <form id="reg-form" class="space-y-4">
                <div><label class="block text-sm font-semibold mb-1">Full Name</label><input type="text" id="r_name" required class="w-full border rounded-lg p-3 outline-none focus:border-blue-500 bg-slate-50 focus:bg-white"></div>
                <div><label class="block text-sm font-semibold mb-1">Email</label><input type="email" id="r_email" required class="w-full border rounded-lg p-3 outline-none focus:border-blue-500 bg-slate-50 focus:bg-white"></div>
                <div><label class="block text-sm font-semibold mb-1">Phone</label><input type="tel" id="r_phone" required class="w-full border rounded-lg p-3 outline-none focus:border-blue-500 bg-slate-50 focus:bg-white"></div>
                <div><label class="block text-sm font-semibold mb-1">Password</label><input type="password" id="r_pass" required class="w-full border rounded-lg p-3 outline-none focus:border-blue-500 bg-slate-50 focus:bg-white"></div>
                <button type="submit" class="w-full bg-slate-900 text-white py-3 rounded-xl font-bold shadow-lg hover:bg-blue-600 transition mt-4">Register</button>
            </form>
            <p class="text-center mt-6 text-sm text-slate-500">Already have an account? <a href="/login" class="text-blue-600 font-bold hover:underline">Sign In</a></p>
            <script>
                document.getElementById('reg-form').onsubmit = async (e) => {
                    e.preventDefault();
                    try {
                        const payload = {name: document.getElementById('r_name').value, email: document.getElementById('r_email').value, phone: document.getElementById('r_phone').value, password: document.getElementById('r_pass').value};
                        const res = await fetch('/api/auth/register', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
                        if(!res.ok) throw new Error((await res.json()).error);
                        window.location.href = '/account';
                    } catch(err) { alert(err.message); }
                };
            </script>
        </div>
    `;
    res.send(renderLayout('Register', html, req));
});

app.get('/account', verifyToken, async (req, res) => {
    if (!req.user) return res.redirect('/login');
    const user = await db.User.findById(req.user.id).select('-password');
    const orders = await db.Order.find({ user: req.user.id }).sort({ createdAt: -1 });
    
    const html = `
        <div class="max-w-6xl mx-auto px-4 py-12 flex flex-col md:flex-row gap-8">
            <aside class="w-full md:w-1/4">
                <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                    <div class="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-2xl font-bold mb-4">${user.name.charAt(0)}</div>
                    <h3 class="font-bold text-lg mb-1">${user.name}</h3>
                    <p class="text-sm text-slate-500 mb-6">${user.email}</p>
                    <button onclick="logout()" class="w-full border border-red-200 text-red-600 py-2 rounded-lg font-medium hover:bg-red-50 transition">Log Out</button>
                </div>
            </aside>
            <main class="w-full md:w-3/4 space-y-6">
                <h2 class="text-2xl font-bold text-slate-900">Order History</h2>
                ${orders.length === 0 ? `<div class="bg-white p-8 rounded-2xl border text-center text-slate-500">No orders placed yet.</div>` : `
                    <div class="space-y-4">
                        ${orders.map(o => `
                            <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-center gap-4">
                                <div>
                                    <div class="text-sm text-slate-500 mb-1">Placed on ${new Date(o.createdAt).toLocaleDateString()}</div>
                                    <div class="font-bold text-lg text-slate-900 mb-1">${o.orderNumber}</div>
                                    <span class="inline-block px-3 py-1 bg-slate-100 text-xs font-semibold rounded-full text-slate-700">${o.status}</span>
                                </div>
                                <div class="text-right flex-1">
                                    <div class="font-bold text-xl text-slate-900 mb-2">৳${o.total}</div>
                                    <a href="/track-order?order=${o.orderNumber}" class="text-blue-600 text-sm font-semibold hover:underline">View Details →</a>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `}
            </main>
        </div>
        <script>const logout = async () => { await fetch('/api/auth/logout', {method:'POST'}); window.location.href='/'; };</script>
    `;
    res.send(renderLayout('Account', html, req));
});

// Vercel Serverless Export & Local Development Start
if (require.main === module) {
    const port = process.env.PORT || 3000;
    app.listen(port, () => console.log(`VELORA Server running on port ${port}`));
}
module.exports = app;
