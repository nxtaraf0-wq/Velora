const express = require('express');
const multer = require('multer');

module.exports = function (db, middlewares) {
    const router = express.Router();
    const { verifyToken, isAdmin } = middlewares;
    const upload = multer({ storage: multer.memoryStorage() });

    // Optional Cloudinary integration helper
    const uploadToCloudinary = async (buffer, mimetype) => {
        if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
            throw new Error("Cloudinary not configured. Please use Image URL text fields.");
        }
        const crypto = require('crypto');
        const url = `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`;
        const timestamp = Math.round((new Date).getTime() / 1000);
        const signature = crypto.createHash('sha1').update(`timestamp=${timestamp}${process.env.CLOUDINARY_API_SECRET}`).digest('hex');
        
        const formData = new FormData();
        const blob = new Blob([buffer], { type: mimetype });
        formData.append('file', blob);
        formData.append('api_key', process.env.CLOUDINARY_API_KEY);
        formData.append('timestamp', timestamp);
        formData.append('signature', signature);

        const res = await fetch(url, { method: 'POST', body: formData });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        return data.secure_url;
    };

    // Generic Admin CRUD API Middleware
    router.use('/api/:resource', verifyToken, isAdmin, async (req, res, next) => {
        const models = { 
            products: db.Product, categories: db.Category, orders: db.Order, 
            banners: db.Banner, campaigns: db.Campaign, discounts: db.Discount, 
            coupons: db.Coupon, customers: db.User 
        };
        req.Model = models[req.params.resource];
        if (!req.Model && req.params.resource !== 'dashboard' && req.params.resource !== 'upload') return res.status(404).json({ error: 'Resource not found' });
        next();
    });

    // Image Upload API
    router.post('/api/upload', verifyToken, isAdmin, upload.single('image'), async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ error: "No file uploaded." });
            const url = await uploadToCloudinary(req.file.buffer, req.file.mimetype);
            res.json({ url });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Dashboard Stats API
    router.get('/api/dashboard', verifyToken, isAdmin, async (req, res) => {
        try {
            const [totalProducts, totalCustomers, totalOrders, pendingOrders, deliveredOrders, recentOrders] = await Promise.all([
                db.Product.countDocuments(), db.User.countDocuments({ role: 'customer' }),
                db.Order.countDocuments(), db.Order.countDocuments({ status: 'Pending Confirmation' }),
                db.Order.countDocuments({ status: 'Delivered' }), db.Order.find().sort({ createdAt: -1 }).limit(5)
            ]);
            const salesPipeline = await db.Order.aggregate([{ $match: { status: 'Delivered' } }, { $group: { _id: null, total: { $sum: '$total' } } }]);
            const totalSales = salesPipeline.length ? salesPipeline[0].total : 0;
            res.json({ totalProducts, totalCustomers, totalOrders, pendingOrders, deliveredOrders, totalSales, recentOrders });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // Generic CRUD API operations
    router.get('/api/:resource', verifyToken, isAdmin, async (req, res) => {
        try {
            let data;
            if (req.params.resource === 'customers') data = await req.Model.find({ role: 'customer' }).select('-password');
            else data = await req.Model.find().sort({ createdAt: -1 });
            res.json(data);
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.post('/api/:resource', verifyToken, isAdmin, async (req, res) => {
        try { res.status(201).json(await req.Model.create(req.body)); } 
        catch (err) { res.status(400).json({ error: err.message }); }
    });

    router.patch('/api/:resource/:id', verifyToken, isAdmin, async (req, res) => {
        try {
            const doc = await req.Model.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
            if(req.params.resource === 'orders' && req.body.status === 'Cancelled' && doc) {
                // Restore stock logically
                for (const item of doc.items) {
                    await db.Product.findByIdAndUpdate(item.product, { $inc: { stock: item.quantity } });
                }
            }
            res.json(doc);
        } catch (err) { res.status(400).json({ error: err.message }); }
    });

    router.delete('/api/:resource/:id', verifyToken, isAdmin, async (req, res) => {
        try { await req.Model.findByIdAndDelete(req.params.id); res.json({ success: true }); } 
        catch (err) { res.status(400).json({ error: err.message }); }
    });

    // Admin UI Route
    router.get('/', (req, res) => {
        res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>VELORA Admin</title>
            <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-slate-50 text-slate-800 font-sans flex h-screen overflow-hidden">
            <aside class="w-64 bg-slate-900 text-white flex flex-col h-full shadow-xl">
                <div class="p-6 text-2xl font-bold tracking-widest text-center border-b border-slate-800">VELORA <span class="text-blue-400 text-sm block tracking-normal font-normal">ADMIN</span></div>
                <nav class="flex-1 overflow-y-auto p-4 space-y-2" id="nav-menu">
                    ${['Dashboard','Products','Categories','Orders','Banners','Campaigns','Discounts','Coupons','Customers'].map(item => `
                        <a href="#${item.toLowerCase()}" class="block px-4 py-2 rounded transition hover:bg-blue-600">${item}</a>
                    `).join('')}
                </nav>
                <div class="p-4 border-t border-slate-800">
                    <button onclick="logout()" class="w-full text-left px-4 py-2 hover:bg-red-600 rounded">Logout</button>
                </div>
            </aside>
            <main class="flex-1 flex flex-col h-full overflow-hidden">
                <header class="bg-white shadow px-8 py-4 flex justify-between items-center">
                    <h1 class="text-xl font-semibold" id="page-title">Dashboard</h1>
                </header>
                <div class="flex-1 overflow-y-auto p-8" id="app-content"></div>
            </main>

            <div id="modal" class="fixed inset-0 bg-black bg-opacity-50 hidden flex justify-center items-center z-50">
                <div class="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto" id="modal-content"></div>
            </div>

            <script>
                const apiCall = async (url, method = 'GET', body = null) => {
                    const res = await fetch(url, {
                        method,
                        headers: body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
                        body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : null
                    });
                    if (res.status === 401 || res.status === 403) window.location.href = '/login';
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Error');
                    return data;
                };

                const logout = async () => { await apiCall('/api/auth/logout', 'POST'); window.location.href = '/'; };
                const showModal = (html) => { document.getElementById('modal-content').innerHTML = html; document.getElementById('modal').classList.remove('hidden'); };
                const closeModal = () => { document.getElementById('modal').classList.add('hidden'); document.getElementById('modal-content').innerHTML = ''; };

                const renderTable = (headers, rows) => \`
                    <div class="bg-white shadow rounded-lg overflow-hidden">
                        <table class="min-w-full divide-y divide-gray-200">
                            <thead class="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                <tr>\${headers.map(h => \`<th class="px-6 py-3">\${h}</th>\`).join('')}</tr>
                            </thead>
                            <tbody class="divide-y divide-gray-200 text-sm">
                                \${rows.map(r => \`<tr>\${r.map(d => \`<td class="px-6 py-4">\${d}</td>\`).join('')}</tr>\`).join('')}
                            </tbody>
                        </table>
                    </div>
                \`;

                const loadDashboard = async () => {
                    try {
                        const stats = await apiCall('/admin/api/dashboard');
                        document.getElementById('app-content').innerHTML = \`
                            <div class="grid grid-cols-4 gap-6 mb-8">
                                \${Object.entries({Products: stats.totalProducts, Customers: stats.totalCustomers, Orders: stats.totalOrders, 'Pending Orders': stats.pendingOrders, Sales: '৳' + stats.totalSales}).map(([k, v]) => \`
                                    <div class="bg-white p-6 rounded-lg shadow-sm border border-slate-100">
                                        <h3 class="text-slate-500 text-sm font-semibold mb-1">\${k}</h3>
                                        <p class="text-3xl font-bold text-slate-800">\${v}</p>
                                    </div>
                                \`).join('')}
                            </div>
                        \`;
                    } catch (e) { alert(e.message); }
                };

                const loadResource = async (resource, columns, mapping) => {
                    const data = await apiCall('/admin/api/' + resource);
                    const rows = data.map(item => mapping(item));
                    const addBtn = resource !== 'customers' ? \`<button onclick="editResource('\${resource}')" class="mb-4 bg-blue-600 text-white px-4 py-2 rounded">Add New</button>\` : '';
                    document.getElementById('app-content').innerHTML = addBtn + renderTable(columns, rows);
                };

                const schemas = {
                    products: [{name:'name'}, {name:'slug'}, {name:'sku'}, {name:'description', type:'textarea'}, {name:'price', type:'number'}, {name:'originalPrice', type:'number'}, {name:'stock', type:'number'}, {name:'category'}, {name:'images', desc:'(Comma separated URLs)'}, {name:'active', type:'checkbox'}, {name:'featured', type:'checkbox'}],
                    categories: [{name:'name'}, {name:'slug'}, {name:'active', type:'checkbox'}],
                    banners: [{name:'title'}, {name:'subtitle'}, {name:'image', desc:'(URL)'}, {name:'link'}, {name:'startDate', type:'date'}, {name:'endDate', type:'date'}, {name:'active', type:'checkbox'}],
                    campaigns: [{name:'name'}, {name:'slug'}, {name:'description', type:'textarea'}, {name:'image', desc:'(URL)'}, {name:'startDate', type:'date'}, {name:'endDate', type:'date'}, {name:'active', type:'checkbox'}],
                    coupons: [{name:'code'}, {name:'type', type:'select', options:['percentage','fixed']}, {name:'value', type:'number'}, {name:'minOrder', type:'number'}, {name:'maxDiscount', type:'number'}, {name:'usageLimit', type:'number'}, {name:'startDate', type:'date'}, {name:'endDate', type:'date'}, {name:'active', type:'checkbox'}],
                    discounts: [{name:'name'}, {name:'type', type:'select', options:['percentage','fixed']}, {name:'value', type:'number'}, {name:'minOrder', type:'number'}, {name:'startDate', type:'date'}, {name:'endDate', type:'date'}, {name:'active', type:'checkbox'}]
                };

                window.editResource = async (resource, id = null) => {
                    let doc = {};
                    if (id) doc = await apiCall('/admin/api/' + resource + '/' + id);
                    if (resource === 'orders') return editOrder(doc);
                    
                    const schema = schemas[resource];
                    const formHtml = schema.map(f => {
                        let input = '';
                        const val = doc[f.name] !== undefined ? doc[f.name] : '';
                        if(f.type === 'checkbox') input = \`<input type="checkbox" id="\${f.name}" \${val ? 'checked' : ''} class="w-4 h-4">\`;
                        else if(f.type === 'textarea') input = \`<textarea id="\${f.name}" class="w-full border rounded p-2">\${val}</textarea>\`;
                        else if(f.type === 'select') input = \`<select id="\${f.name}" class="w-full border rounded p-2">\${f.options.map(o => \`<option value="\${o}" \${val === o ? 'selected':''}>\${o}</option>\`).join('')}</select>\`;
                        else input = \`<input type="\${f.type || 'text'}" id="\${f.name}" value="\${val}" class="w-full border rounded p-2">\`;
                        return \`<div class="mb-4"><label class="block text-sm font-semibold mb-1 uppercase">\${f.name} \${f.desc || ''}</label>\${input}</div>\`;
                    }).join('');

                    showModal(\`
                        <h2 class="text-xl mb-4 font-bold">\${id ? 'Edit' : 'Add'} \${resource.slice(0,-1)}</h2>
                        <form id="res-form">
                            \${formHtml}
                            <div class="flex justify-end space-x-2 mt-6">
                                <button type="button" onclick="closeModal()" class="px-4 py-2 border rounded">Cancel</button>
                                <button type="submit" class="px-4 py-2 bg-blue-600 text-white rounded">Save</button>
                            </div>
                        </form>
                    \`);

                    document.getElementById('res-form').onsubmit = async (e) => {
                        e.preventDefault();
                        const payload = {};
                        schema.forEach(f => {
                            const el = document.getElementById(f.name);
                            if(f.type === 'checkbox') payload[f.name] = el.checked;
                            else if(f.name === 'images') payload[f.name] = el.value.split(',').map(s=>s.trim()).filter(Boolean);
                            else payload[f.name] = el.value;
                        });
                        try {
                            await apiCall(id ? '/admin/api/' + resource + '/' + id : '/admin/api/' + resource, id ? 'PATCH' : 'POST', payload);
                            closeModal(); route();
                        } catch(err) { alert(err.message); }
                    };
                };

                window.editOrder = (order) => {
                    const statuses = ['Pending Confirmation', 'Confirmed', 'Processing', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled'];
                    showModal(\`
                        <h2 class="text-xl mb-4 font-bold">Manage Order: \${order.orderNumber}</h2>
                        <p class="mb-2"><strong>Total:</strong> ৳\${order.total}</p>
                        <p class="mb-4"><strong>Payment:</strong> \${order.paymentMethod} - \${order.paymentStatus}</p>
                        <div class="mb-4">
                            <label class="block font-semibold mb-1">Status</label>
                            <select id="order-status" class="w-full border p-2 rounded">
                                \${statuses.map(s => \`<option value="\${s}" \${order.status === s ? 'selected' : ''}>\${s}</option>\`).join('')}
                            </select>
                        </div>
                        <div class="flex justify-end space-x-2">
                            <button onclick="closeModal()" class="px-4 py-2 border rounded">Cancel</button>
                            <button onclick="saveOrderStatus('\${order._id}')" class="px-4 py-2 bg-blue-600 text-white rounded">Update Order</button>
                        </div>
                    \`);
                };

                window.saveOrderStatus = async (id) => {
                    const status = document.getElementById('order-status').value;
                    const paymentStatus = status === 'Delivered' ? 'Paid' : 'Unpaid';
                    try {
                        await apiCall('/admin/api/orders/' + id, 'PATCH', { status, paymentStatus });
                        closeModal(); route();
                    } catch(e) { alert(e.message); }
                };

                window.deleteResource = async (resource, id) => {
                    if(!confirm('Delete this item?')) return;
                    try { await apiCall('/admin/api/' + resource + '/' + id, 'DELETE'); route(); } 
                    catch(e) { alert(e.message); }
                };

                const actions = (res, id) => \`
                    <button onclick="editResource('\${res}', '\${id}')" class="text-blue-600 mr-2">Edit</button>
                    \${res !== 'orders' && res !== 'customers' ? \`<button onclick="deleteResource('\${res}', '\${id}')" class="text-red-600">Delete</button>\` : ''}
                \`;

                const route = () => {
                    const hash = window.location.hash.substring(1) || 'dashboard';
                    document.getElementById('page-title').innerText = hash.charAt(0).toUpperCase() + hash.slice(1);
                    
                    if (hash === 'dashboard') loadDashboard();
                    else if (hash === 'products') loadResource('products', ['Name','Price','Stock','Active','Actions'], r => [r.name, '৳'+r.price, r.stock, r.active?'Yes':'No', actions(hash, r._id)]);
                    else if (hash === 'categories') loadResource('categories', ['Name','Slug','Active','Actions'], r => [r.name, r.slug, r.active?'Yes':'No', actions(hash, r._id)]);
                    else if (hash === 'orders') loadResource('orders', ['Order #','Date','Status','Total','Actions'], r => [r.orderNumber, new Date(r.createdAt).toLocaleDateString(), r.status, '৳'+r.total, actions(hash, r._id)]);
                    else if (hash === 'banners') loadResource('banners', ['Title','Start','End','Active','Actions'], r => [r.title, new Date(r.startDate).toLocaleDateString(), new Date(r.endDate).toLocaleDateString(), r.active?'Yes':'No', actions(hash, r._id)]);
                    else if (hash === 'campaigns') loadResource('campaigns', ['Name','Start','End','Active','Actions'], r => [r.name, new Date(r.startDate).toLocaleDateString(), new Date(r.endDate).toLocaleDateString(), r.active?'Yes':'No', actions(hash, r._id)]);
                    else if (hash === 'coupons') loadResource('coupons', ['Code','Discount','Usage','Active','Actions'], r => [r.code, r.type==='percentage'?r.value+'%':'৳'+r.value, \`\${r.usedCount}/\${r.usageLimit}\`, r.active?'Yes':'No', actions(hash, r._id)]);
                    else if (hash === 'discounts') loadResource('discounts', ['Name','Discount','Min Order','Active','Actions'], r => [r.name, r.type==='percentage'?r.value+'%':'৳'+r.value, '৳'+r.minOrder, r.active?'Yes':'No', actions(hash, r._id)]);
                    else if (hash === 'customers') loadResource('customers', ['Name','Email','Phone'], r => [r.name, r.email, r.phone]);
                };

                window.addEventListener('hashchange', route);
                window.onload = route;
            </script>
        </body>
        </html>
        `);
    });

    return router;
};
