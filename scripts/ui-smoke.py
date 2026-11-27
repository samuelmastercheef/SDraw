# Thử giao diện bằng Chrome không đầu, với API Electron được giả lập. Cần: pip install playwright, google-chrome, npm run build.
# Chạy: python3 scripts/ui-smoke.py  (phải đổi đường dẫn out/renderer nếu repo nằm chỗ khác)
import sys, subprocess, time, json
from playwright.sync_api import sync_playwright
srv = subprocess.Popen(['python3','-m','http.server','4199','-d','out/renderer'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(1)
MOCK = """
window.__calls=[];
const store={catalog:[{id:'a',name:'Sofa A',category:'Sofa',w:2400,d:900,h:800,tags:['chữ L']},{id:'b',name:'Bàn trà',category:'Bàn trà',w:1000,d:600,h:400}]};
window.__proj=[]; window.__mine=[];
window.__set={serverUrl:'http://x',token:'t',user:{id:'u',name:'Chu',businessId:'b1',role:'admin'},folders:[],autoDetect:true,autoIndex:true,autoSync:false,autoWatch:true,autoBackup:false,lastBackupAt:0,image:{provider:'socin',monthlyLimit:300,lanHost:'',lanPort:8188,staffAllowed:true,watermark:true}};
window.sdraw={
 storePutCover:async(id,d)=>{window.__calls.push(['cover',id,d.slice(0,22)]);return {status:200,data:{}}}, storeCover:async()=>null, scanCancel:async()=>{}, onScanProgress:(cb)=>{window.__prog=cb;return ()=>{}}, onFolderChanged:(cb)=>{window.__chg=cb;return ()=>{}}, backupPush:async()=>({samples:2,projects:1}), backupList:async()=>[{id:1,createdAt:1700000000000,size:2048,samples:2,projects:1}], backupPull:async()=>({samples:1,projects:0}), backupExport:async()=>({file:'/tmp/b.json',samples:2,projects:1}), backupRestore:async()=>({samples:1,projects:0}), openMesh:async()=>({path:'/tmp/cube.obj',name:'cube.obj',kind:'obj',data:new TextEncoder().encode('v 0 0 0\\nv 100 0 0\\nv 0 100 0\\nv 0 0 100\\nf 1 2 3\\nf 1 2 4\\nf 2 3 4\\nf 1 3 4\\n')}), openWarehouse:async(q)=>{window.__calls.push(['warehouse',q])}, storeUploadFile:async(id)=>({status:200,data:{}}), storeDownloadFile:async()=>'/tmp/m.skp', listProjects:async()=>window.__proj, saveProject:async(p)=>{window.__proj=window.__proj.filter(x=>x.id!==p.id);window.__proj.unshift(p)}, deleteProject:async(id)=>{window.__proj=window.__proj.filter(x=>x.id!==id)},
 loadCatalog:async()=>store.catalog, saveCatalog:async(c)=>{window.__calls.push(['saveCatalog',c.length])},
 scanFolder:async()=>({folder:"/x/Mau",paths:["/x/Mau/a.skp","/x/Mau/b.skp"],truncated:false}), scanPath:async(p)=>({folder:p,paths:["/x/Mau/a.skp","/x/Mau/b.skp"],truncated:false}), openDoc:async()=>null, saveDoc:async()=>null, exportDxf:async()=>null, exportXlsx:async()=>null, exportSketchupJson:async()=>null,
 importFiles:async()=>[{fileName:'x.png',sample:{id:'imp1',name:'x',category:'Chưa phân loại',w:0,d:0,h:0},needsDimensions:true,warnings:[]},{fileName:'bad.xyz',error:'Định dạng không hỗ trợ'}],
 saveSketch:async(d)=>{window.__calls.push(['saveSketch',d.name]);return '/tmp/x.sdsketch'}, openSketch:async()=>null, exportSvg:async()=>null,
 openReferenceImage:async()=>({src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC',width:10,height:10,name:'mat-bang.png'}),
 getSettings:async()=>window.__set,
 setSettings:async(s)=>{window.__set={...window.__set,...s};return window.__set},
 generateImage:async()=>({status:200,data:{image:'iVBORw0KGgo='}}), net:async(m,p,b)=>{window.__calls.push(['net',m,p]); if(p.startsWith('/v1/ai/chat')) return {status:200,data:{reply:'Mình hiểu yêu cầu: Sofa.',items:[{key:'k',category:'Sofa',w:2400,d:900,h:800,styles:[],score:50,reasons:['Đúng loại Sofa'],own:false}],storeSimilar:2}}; if(p.startsWith('/v1/store/search')) return {status:200,data:{total:1,items:[{id:'1',title:'Sofa Store',category:'Sofa',w:2000,d:900,h:800,tags:[],styles:[],materials:[],hasFile:true}]}}; if(p==='/v1/store/mine') return {status:200,data:{items:window.__mine}}; if(p==='/v1/store/listings'&&m==='POST'){window.__mine.unshift({id:'abcdefgh1',title:b.title,category:b.category,status:'draft',hasFile:false,fileName:null,fileSize:0,rejectReason:null});return {status:201,data:{id:'abcdefgh1'}}} if(p.endsWith('/submit')){window.__mine[0].status='pending';return {status:200,data:{}}} if(p==='/v1/admin/listings') return {status:200,data:{items:[{id:'zzzzzzzz1',title:'Gói chờ',category:'Sofa',fileName:'a.skp',fileSize:2097152,description:''}]}}; if(p.startsWith('/v1/admin')) return {status:200,data:{items:[],total:0,labeled:0,businesses:0}}; return {status:200,data:{accepted:0,rejected:[]}} }
};
"""
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',args=['--no-sandbox'])
    pg=b.new_page(viewport={'width':1440,'height':900})
    pg.on('pageerror',lambda e:errs.append('pageerror: '+str(e)))
    pg.on('console',lambda m:errs.append('console.'+m.type+': '+m.text) if m.type in('error','warning') else None)
    pg.on('response',lambda r:errs.append('HTTP '+str(r.status)+' '+r.url) if r.status>=400 else None)
    pg.add_init_script(MOCK)
    pg.goto('http://127.0.0.1:4199/index.html'); pg.wait_for_timeout(800)
    res={}
    pg.get_by_role('button',name='Nhập mặt bằng').click(); pg.get_by_role('button',name='Chọn file…').click(); pg.wait_for_timeout(300)
    wb=pg.locator('.plan-wrap').bounding_box()
    pg.mouse.click(wb['x']+5,wb['y']+5); pg.mouse.click(wb['x']+wb['width']/2,wb['y']+5)
    pg.get_by_label('Độ dài thật giữa 2 điểm (mm)').fill('2000'); pg.get_by_role('button',name='Tiếp tục').click()
    wb=pg.locator('.plan-wrap').bounding_box()
    pg.mouse.click(wb['x']+2,wb['y']+2); pg.mouse.click(wb['x']+wb['width']-2,wb['y']+wb['height']-2)
    res['plan_w']=pg.get_by_label('Rộng (mm)').input_value()
    pg.get_by_role('button',name='Tạo dự án từ mặt bằng').click(); pg.wait_for_timeout(300)
    res['plan_name']=pg.locator('.name').first.inner_text()
    res['plan_toggle']=pg.get_by_text('Hiện mặt bằng nền').count()
    # tự nhận tường và cửa trên bản vẽ tổng hợp 400x300, tường dày 4px, hở 50px ở tường trên
    pg.evaluate("""() => {
      const c=document.createElement('canvas'); c.width=400; c.height=300; const g=c.getContext('2d');
      g.fillStyle='#fff'; g.fillRect(0,0,400,300); g.fillStyle='#000';
      g.fillRect(50,40,150,4); g.fillRect(200,40,0,4); g.fillRect(200,40,153,4); g.fillRect(50,257,304,4); g.fillRect(50,40,4,221); g.fillRect(350,40,4,221);
      g.fillStyle='#fff'; g.fillRect(150,40,50,4);
      const src=c.toDataURL('image/png'); window.__origRef=window.sdraw.openReferenceImage; window.sdraw.openReferenceImage=async()=>({src,width:400,height:300,name:'auto.png'});
    }""")
    pg.get_by_role('button',name='Nhập mặt bằng').click(); pg.get_by_role('button',name='Chọn file…').click(); pg.wait_for_timeout(400)
    wb=pg.locator('.plan-wrap').bounding_box()
    pg.mouse.click(wb['x']+wb['width']*0.1,wb['y']+20); pg.mouse.click(wb['x']+wb['width']*0.6,wb['y']+20)
    pg.get_by_label('Độ dài thật giữa 2 điểm (mm)').fill('4000'); pg.get_by_role('button',name='Tiếp tục').click()
    pg.get_by_role('button',name='Tự nhận phòng và cửa').click(); pg.wait_for_timeout(500)
    res['auto_w']=pg.get_by_label('Rộng (mm)').input_value(); res['auto_d']=pg.get_by_label('Sâu (mm)').input_value()
    res['auto_notice']=pg.locator('.notice').inner_text()
    pg.evaluate("window.sdraw.openReferenceImage = window.__origRef")
    pg.get_by_role('button',name='Xuất',exact=True).click(); pg.wait_for_timeout(200)
    res['export_boxes']=pg.locator('.check input').count()
    pg.get_by_role('button',name='Xuất 3 mục đã chọn').click(); pg.wait_for_timeout(200)
    pg.get_by_role('button',name='Cài đặt').click(); pg.get_by_role('tab',name='Sao lưu').click(); pg.wait_for_timeout(100)
    pg.get_by_role('button',name='Sao lưu ngay').click(); pg.wait_for_timeout(200)
    res['backup_notice']=pg.locator('.notice').inner_text()
    res['server_backup_rows']=pg.locator('table.lib-table tbody tr').count()
    pg.get_by_role('button',name='Sao lưu lên máy chủ').click(); pg.wait_for_timeout(200); res['server_backup_notice']=pg.locator('.notice').inner_text()
    pg.get_by_role('button',name='Khôi phục',exact=True).click(); pg.wait_for_timeout(200); res['server_restore_notice']=pg.locator('.notice').inner_text()
    pg.get_by_role('tab',name='Nguồn dữ liệu').click(); pg.get_by_role('button',name='+ Thêm thư mục').click(); pg.wait_for_timeout(300)
    res['folders']=pg.locator('.cards .card').count()
    pg.get_by_role('button',name='Lập chỉ mục ngay').click(); pg.wait_for_timeout(300)
    res['reindex_notice']=pg.locator('.notice').inner_text()
    pg.evaluate("window.sdraw.scanPath = async (p) => ({folder:p,paths:['/x/Mau/a.skp','/x/Mau/b.skp','/x/Mau/moi.skp'],truncated:false})"); pg.evaluate("window.__chg({folder:'/x/Mau'})"); pg.wait_for_timeout(400)
    res['watch_notice']=pg.locator('.notice').inner_text()
    pg.evaluate("window.__prog({folder:'/x/Mau',found:5,dirs:2})")
    pg.get_by_role('switch',name='Tự đồng bộ chỉ mục lên VPS').click(); res['autosync']=pg.get_by_role('switch',name='Tự đồng bộ chỉ mục lên VPS').get_attribute('aria-checked')
    pg.get_by_role('tab',name='Tạo ảnh').click(); pg.get_by_role('radio',name='Máy chủ trong văn phòng').click()
    res['lan_fields']=pg.locator('#lh').count()
    pg.get_by_role('button',name='Gỡ').count()
    pg.get_by_role('button',name='Dự án',exact=True).click(); pg.wait_for_timeout(200)
    pg.get_by_label('Tên dự án').fill('Nhà chị Lan'); pg.get_by_label('Khách hàng',exact=True).fill('Lan')
    pg.get_by_role('button',name='Phòng ngủ').click(); pg.get_by_role('button',name='Tạo dự án').click(); pg.wait_for_timeout(300)
    res['proj_opened_name']=pg.locator('.name').first.inner_text()
    pg.get_by_role('button',name='Dự án',exact=True).click(); pg.wait_for_timeout(200)
    res['proj_cards']=pg.locator('.cards .card').count()
    pg.get_by_label('Tìm theo tên hoặc khách hàng').fill('zzz'); res['proj_filtered']=pg.locator('.cards .card').count()
    pg.get_by_role('button',name='Phác thảo').click(); pg.wait_for_timeout(300)
    res['svg']=pg.locator('.sketch-canvas svg').count()
    res['shapes']=pg.locator('.sketch-canvas svg path').count()
    res['size_text']=pg.locator('.sketch-top .muted').inner_text()
    pg.screenshot(path='/tmp/s1.png')
    # chọn khung: bấm vào giữa sofa
    box=pg.locator('.sketch-canvas svg').bounding_box()
    cx,cy=box['x']+box['width']/2, box['y']+box['height']/2
    pg.mouse.click(cx,cy); pg.wait_for_timeout(200)
    res['selected_panel']=pg.locator('.name-input').count()
    res['node_handles']=pg.locator('.sketch-canvas svg rect[style*="move"]').count()
    # kéo nút đầu tiên
    h=pg.locator('.sketch-canvas svg rect[style*="move"]').first
    if h.count():
        hb=h.bounding_box(); pg.mouse.move(hb['x']+hb['width']/2,hb['y']+hb['height']/2); pg.mouse.down(); pg.mouse.move(hb['x']-60,hb['y']-40,steps=6); pg.mouse.up(); pg.wait_for_timeout(200)
    res['after_drag_size']=pg.locator('.sketch-top .muted').inner_text()
    res['undo_enabled']=pg.locator('.sketch-top button[aria-label="Hoàn tác"]').is_enabled()
    # đổi thông số rộng
    f=pg.locator('.sketch-side').get_by_label('Rộng').first; f.fill('3000'); f.press('Enter'); pg.wait_for_timeout(200)
    res['after_param']=pg.locator('.sketch-top .muted').inner_text()
    # vẽ bằng công cụ chữ nhật
    pg.keyboard.press('r'); pg.mouse.move(box['x']+100,box['y']+100); pg.mouse.down(); pg.mouse.move(box['x']+260,box['y']+200,steps=5); pg.mouse.up(); pg.wait_for_timeout(200)
    res['layers']=pg.locator('.layers li').count()
    # bút: 3 điểm, Enter
    pg.keyboard.press('p')
    for x,y in [(150,500),(300,520),(260,640)]:
        pg.mouse.click(box['x']+x,box['y']+y)
    pg.keyboard.press('Enter'); pg.wait_for_timeout(200)
    res['layers_after_pen']=pg.locator('.layers li').count()
    # ảnh nền + đặt tỉ lệ
    pg.get_by_role('button',name='Chọn ảnh…').click(); pg.wait_for_timeout(300)
    res['ref_img']=pg.locator('.sketch-canvas svg image').count()
    box2=pg.locator('.sketch-canvas svg').bounding_box()
    pg.mouse.click(box2['x']+300,box2['y']+300); pg.mouse.click(box2['x']+500,box2['y']+300); pg.wait_for_timeout(200)
    pg.locator('#real').fill('2000'); pg.locator('#real').press('Enter'); pg.wait_for_timeout(200)
    res['ref_size_hint']=pg.locator('.sketch-side .hint').filter(has_text='mat-bang.png').inner_text()
    # nhập PDF: gỡ ảnh, đổi mock sang PDF, trang đầu phải thành ảnh PNG
    pg.get_by_role('button',name='Gỡ ảnh').click(); pg.wait_for_timeout(200)
    pg.evaluate("window.sdraw.openReferenceImage = async () => ({src:'data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAzMDAgMjAwXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA2NiA+PgpzdHJlYW0KMCAwIDAgcmcgMjAgMjAgMjYwIDE2MCByZSBTIEJUIC9GMSAyNCBUZiA2MCA5MCBUZCAoTUFUIEJBTkcpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwMzU3IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNDI3CiUlRU9GCg==',width:0,height:0,name:'mb.pdf'})")
    pg.get_by_role('button',name='Chọn ảnh…').click(); pg.wait_for_timeout(1500)
    res['pdf_img']=pg.locator('.sketch-canvas svg image').count()
    res['pdf_href']=pg.locator('.sketch-canvas svg image').first.get_attribute('href')[:22]
    res['pdf_hint']=pg.locator('.sketch-side .hint').filter(has_text='trang 1').inner_text()
    pg.get_by_role('button',name='Gỡ ảnh').click(); pg.wait_for_timeout(200)
    # nút góc nhọn: bật làm mượt rồi chọn nút
    pg.keyboard.press('v'); pg.get_by_role('button',name='Chữ nhật',exact=True).click() if False else None
    # bàn tròn
    pg.get_by_role('button',name='Bàn tròn').click(); pg.wait_for_timeout(300)
    res['table_size']=pg.locator('.sketch-top .muted').inner_text()
    res['table_name']=pg.locator('.sketch-name').inner_text()
    pg.screenshot(path='/tmp/s2.png')
    pg.get_by_role('button',name='Ghế ăn').click(); pg.wait_for_timeout(300)
    res['chair_size']=pg.locator('.sketch-top .muted').inner_text()
    pg.get_by_role('button',name='Lưu vào kho mẫu').click(); pg.wait_for_timeout(300)
    res['notice']=pg.locator('.notice').inner_text() if pg.locator('.notice').count() else None
    # chat
    pg.get_by_role('button',name='Chat thiết kế').click(); pg.locator('textarea').first.fill('sofa chữ L 2m4'); pg.get_by_role('button',name='Gửi',exact=True).click(); pg.wait_for_timeout(600)
    res['chat_chips']=pg.locator('.msg-ai .chips-row .pill').all_inner_texts(); res['chat_plan']=pg.locator('.plan-card svg').count(); res['chat_followups']=pg.locator('.follow-ups .chip').count(); res['chat_side']=pg.locator('.chat-side h3').inner_text()
    pg.get_by_role('button',name='Thêm kệ sách').click(); pg.wait_for_timeout(500); res['chat_turns']=pg.locator('.msg-user').count()
    pg.screenshot(path='/tmp/chat.png')
    res['chat_cards']=pg.locator('.cards .card').count(); res['store_hint']=pg.locator('.store-hint').count()
    pg.screenshot(path='/tmp/s3.png')
    pg.get_by_role('button',name='Store',exact=True).click(); pg.wait_for_timeout(500); res['store_cards']=pg.locator('.cards .card').count(); res['download_btn']=pg.get_by_role('button',name='Tải file .skp').count()
    pg.get_by_role('button',name='Xem chi tiết').first.click(); pg.wait_for_timeout(300); res['detail_title']=pg.locator('.detail-side h1').inner_text(); res['detail_license']=pg.get_by_text('Giấy phép sử dụng').count(); pg.get_by_role('button',name='← Về Store').click(); pg.wait_for_timeout(200)
    pg.get_by_role('button',name='Đăng mẫu của tôi').click(); pg.wait_for_timeout(300)
    pg.get_by_label('Mẫu do doanh nghiệp tự làm hoặc có quyền đăng bán').check(); pg.get_by_role('button',name='Tạo gói nháp').click(); pg.wait_for_timeout(300)
    res['sell_status_1']=pg.locator('.cards .card .badge').first.inner_text()
    pg.evaluate("window.sdraw.openReferenceImage = async () => ({src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC',width:10,height:10,name:'bia.png'})")
    pg.get_by_role('button',name='Ảnh bìa',exact=True).click(); pg.wait_for_timeout(500)
    res['cover_notice']=pg.locator('.notice').inner_text(); res['cover_call']=pg.evaluate("window.__calls.filter(c=>c[0]==='cover').map(c=>c[2])")
    pg.get_by_role('button',name='Tải file .skp').click(); pg.wait_for_timeout(300)
    # mock chưa cập nhật hasFile; ép trạng thái để thử gửi duyệt
    res['sell_notice']=pg.locator('.notice').inner_text()
    pg.get_by_role('button',name='Thư viện').click(); pg.get_by_role('button',name='Tải mẫu lên…').click(); pg.get_by_role('button',name='Chọn file…').click(); pg.wait_for_timeout(300)
    res['import_rows']=pg.locator('.import-table tbody tr').count(); res['add_disabled_before_rights']=pg.get_by_role('button',name='Thêm 0 mẫu vào kho').is_disabled() if pg.get_by_role('button',name='Thêm 0 mẫu vào kho').count() else 'n/a'; res['rights_box']=pg.get_by_label('Mẫu do doanh nghiệp tự làm hoặc có quyền dùng').count(); res['import_add_disabled']=pg.get_by_role('button',name=lambda n: n.startswith('Thêm')) if False else None
    pg.screenshot(path='/tmp/s4.png')
    pg.get_by_role('button',name='Đóng').click()
    pg.get_by_role('button',name='Gắn nhãn').click(); pg.wait_for_timeout(300); res['admin_ok']=pg.locator('.page h2').inner_text(); res['pending_listings']=pg.get_by_role('button',name='Duyệt',exact=True).count(); res['filter_editor']=pg.get_by_text('Bộ lọc dữ liệu theo doanh nghiệp').count()
    pg.get_by_role('button',name='Cài đặt').click(); pg.wait_for_timeout(300); res['settings_ok']=pg.locator('.page h2').inner_text()
    pg.get_by_role('button',name='Thư viện').click(); pg.get_by_role('button',name='Tìm trên 3D Warehouse').click(); pg.wait_for_timeout(200)
    pg.get_by_role('button',name='Xem file 3D…').click(); pg.wait_for_timeout(200); res['mesh_polys']=pg.locator('.modal-card svg.preview3d polygon').count(); res['mesh_info']=pg.locator('.modal-card .hint').first.inner_text()[:40]; res['mesh_size']=pg.locator('.modal-card .hint').nth(1).inner_text()[:60]; pg.get_by_role('button',name='Lưu vào kho mẫu').click(); pg.wait_for_timeout(200); res['mesh_saved']=pg.get_by_text('cube').count()
    res['lib_cols']=pg.locator('.lib-table thead th').all_inner_texts()[:3]
    res['lib_id_chip']=pg.locator('.lib-table .id-chip').count()>0
    res['lib_desc_field']=pg.locator('.lib-table textarea').count()>0
    res['warehouse_called']=pg.evaluate("window.__calls.some(c=>c[0]==='warehouse')")
    res['warehouse_notice']=pg.locator('.notice').inner_text()
    pg.get_by_role('button',name='Phác thảo').click(); pg.wait_for_timeout(200)
    for nm,exp in (('Giường','1600'),('Kệ sách','800'),('Tủ áo','1800')):
        pg.get_by_role('button',name=nm,exact=True).click(); pg.wait_for_timeout(200)
        res['sketch_'+nm]=pg.locator('.sketch-top .muted').inner_text(); res['preview3d_'+nm]=pg.locator('svg.preview3d polygon').count()
    pg.get_by_role('button',name='Bố cục').first.click(); pg.wait_for_timeout(200)
    pg.get_by_label('Lệnh sửa bố cục').fill('làm cho đẹp hơn'); pg.get_by_role('button',name='Đề xuất').click(); pg.wait_for_timeout(100)
    res['edit_note']=pg.locator('.edit-note').first.inner_text()[:30]
    pg2=b.new_page(viewport={'width':1440,'height':900}); pg2.add_init_script(MOCK); pg2.add_init_script("window.__set.user=null; window.__set.token=''")
    pg2.goto('http://127.0.0.1:4199/index.html'); pg2.wait_for_timeout(800)
    res['login_shown']=pg2.locator('.login-screen').count(); res['login_cta']=pg2.get_by_role('button',name='Đăng nhập với Socin').count()
    pg2.get_by_role('button',name='Mở ngoại tuyến với dữ liệu riêng').click(); pg2.wait_for_timeout(200); res['login_after_offline']=pg2.locator('.login-screen').count()
    print(json.dumps(res,ensure_ascii=False,indent=1)); print('ERRORS:',errs)
    b.close()
srv.terminate()
