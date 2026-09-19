const baseBorrowers = [
  {name:'Sarah Mitchell',phone:'(555) 241-8830',amount:12000,payment:1080,due:'Sep 21, 2026',progress:67,score:92,status:'On track',color:'#e8d2c1'},
  {name:'David Kim',phone:'(555) 890-1124',amount:8500,payment:765,due:'Sep 23, 2026',progress:42,score:86,status:'On track',color:'#d4e5dc'},
  {name:'Marcus Brown',phone:'(555) 774-3091',amount:15000,payment:1320,due:'Sep 24, 2026',progress:25,score:74,status:'Due soon',color:'#d7dff1'},
  {name:'Elena Rodriguez',phone:'(555) 392-6540',amount:6750,payment:610,due:'Sep 26, 2026',progress:83,score:95,status:'On track',color:'#f3dbd4'},
  {name:'Thomas Wright',phone:'(555) 118-4577',amount:22000,payment:1950,due:'Sep 15, 2026',progress:51,score:61,status:'Overdue',color:'#e5d9ef'}
];
const saved = JSON.parse(localStorage.getItem('lendwiseBorrowers') || '[]');
let borrowers = [...saved, ...baseBorrowers];
const money = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
const initials = name => name.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase();

function renderRows(list=borrowers){
  document.querySelector('#borrowerRows').innerHTML=list.map(b=>`<tr><td><div class="person"><div class="borrower-avatar" style="background:${b.color}">${initials(b.name)}</div><div><strong>${b.name}</strong><small>${b.phone}</small></div></div></td><td class="amount"><strong>${money(b.amount)}</strong><small>${b.months?b.months+' months':'12 months'}</small></td><td><strong>${money(b.payment)}</strong></td><td>${b.due}</td><td><span class="progress"><i style="width:${b.progress}%"></i></span>${b.progress}%</td><td class="score">${b.score}</td><td><span class="status ${b.status==='On track'?'ontime':b.status==='Due soon'?'due':'overdue'}">${b.status}</span></td><td><button class="more">•••</button></td></tr>`).join('');
  document.querySelector('#tableCount').textContent=`Showing ${list.length} of ${borrowers.length + 19} borrowers`;
}
function renderChart(){
  const data=[['Apr',71,62],['May',80,74],['Jun',76,68],['Jul',90,84],['Aug',82,73],['Sep',72,58]];
  document.querySelector('#chart').innerHTML=data.map(([m,e,c])=>`<div class="bar-group"><i class="bar expected" style="height:${e}%"></i><i class="bar collected" style="height:${c}%"></i><span class="bar-label">${m}</span></div>`).join('');
}
function renderUpcoming(){
  document.querySelector('#upcomingList').innerHTML=borrowers.slice(0,4).map((b,i)=>`<div class="upcoming-row"><div class="due-avatar" style="background:${b.color}">${initials(b.name)}</div><div><strong>${b.name}</strong><small>${i===0?'Due tomorrow':`Due in ${i+2} days`} · ${b.due}</small></div><div class="due-amount"><strong>${money(b.payment)}</strong><span>${i===0?'Reminder sent':'Scheduled'}</span></div></div>`).join('');
}
renderRows(); renderChart(); renderUpcoming();

const modal=document.querySelector('#loanModal');
['newLoanTop','newLoanHero','addBorrower'].forEach(id=>document.querySelector('#'+id).onclick=()=>modal.showModal());
document.querySelector('#menuBtn').onclick=()=>document.querySelector('#sidebar').classList.toggle('open');
const form=document.querySelector('#loanForm');
function calculate(){const a=+form.amount.value,m=+form.months.value,r=+form.rate.value/1200;if(!a||!m)return 0;return r?a*r*Math.pow(1+r,m)/(Math.pow(1+r,m)-1):a/m}
form.addEventListener('input',()=>document.querySelector('#paymentPreview').textContent=money(calculate()));
document.querySelector('#saveLoan').addEventListener('click',e=>{if(!form.reportValidity()){e.preventDefault();return}e.preventDefault();const fd=new FormData(form);const due=new Date(fd.get('due')+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});const item={name:fd.get('name'),phone:fd.get('phone'),amount:+fd.get('amount'),months:+fd.get('months'),payment:Math.round(calculate()),due,progress:0,score:75,status:'On track',color:'#d8eadf',address:fd.get('address'),referrer:fd.get('referrer'),family:fd.get('family')};saved.unshift(item);localStorage.setItem('lendwiseBorrowers',JSON.stringify(saved));borrowers.unshift(item);renderRows();renderUpcoming();modal.close();form.reset();document.querySelector('#paymentPreview').textContent='$0.00';showToast(`${item.name} was added successfully.`)});
document.querySelector('#searchInput').addEventListener('input',e=>renderRows(borrowers.filter(b=>b.name.toLowerCase().includes(e.target.value.toLowerCase()))));
document.querySelector('#exportBtn').onclick=()=>{const cols=['Name','Phone','Loan Amount','Monthly Payment','Next Due','Score','Status'];const rows=borrowers.map(b=>[b.name,b.phone,b.amount,b.payment,b.due,b.score,b.status]);const csv=[cols,...rows].map(r=>r.map(v=>`"${v}"`).join(',')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='lendwise-portfolio.csv';a.click();URL.revokeObjectURL(a.href);showToast('Excel-compatible report downloaded.')};
document.querySelector('#enableAlerts').onclick=async()=>{if(!('Notification' in window))return showToast('Notifications are not supported here.');const result=await Notification.requestPermission();showToast(result==='granted'?'Payment reminders are enabled.':'Notification permission was not granted.')};
function showToast(msg){document.querySelector('#toastText').textContent=msg;const t=document.querySelector('#toast');t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000)}
