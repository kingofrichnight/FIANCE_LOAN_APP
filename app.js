const saved = JSON.parse(localStorage.getItem('lendwiseBorrowers') || '[]');
let borrowers = [...saved];
const rates={USD:1,INR:83.5,CNY:7.2,EUR:.92,GBP:.79};
let currency=localStorage.getItem('lendwiseCurrency')||'USD';
const money = n => new Intl.NumberFormat('en-US',{style:'currency',currency,maximumFractionDigits:0}).format(n*rates[currency]);
const initials = name => name.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase();

function renderRows(list=borrowers){
  if(!list.length){document.querySelector('#borrowerRows').innerHTML='<tr><td colspan="8">No borrowers yet. Add your first borrower to begin.</td></tr>';document.querySelector('#tableCount').textContent='Showing 0 borrowers';return}
  document.querySelector('#borrowerRows').innerHTML=list.map(b=>`<tr><td><div class="person"><div class="borrower-avatar" style="background:${b.color}">${initials(b.name)}</div><div><strong>${b.name}</strong><small>${b.phone}</small></div></div></td><td class="amount"><strong>${money(b.amount)}</strong><small>${b.months?b.months+' months':'12 months'}</small></td><td><strong>${money(b.payment)}</strong></td><td>${b.due}</td><td><span class="progress"><i style="width:${b.progress}%"></i></span>${b.progress}%</td><td class="score">${b.score}</td><td><span class="status ${b.status==='On track'?'ontime':b.status==='Due soon'?'due':'overdue'}">${b.status}</span></td><td><button class="more">•••</button></td></tr>`).join('');
  document.querySelector('#tableCount').textContent=`Showing ${list.length} of ${borrowers.length} borrowers`;
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
form.querySelector('.close').addEventListener('click',e=>{e.preventDefault();modal.close();});
function calculate(){const a=+form.amount.value,m=+form.months.value,r=+form.rate.value/1200;if(!a||!m)return 0;return r?a*r*Math.pow(1+r,m)/(Math.pow(1+r,m)-1):a/m}
form.addEventListener('input',()=>document.querySelector('#paymentPreview').textContent=money(calculate()));
document.querySelector('#currencySelect').value=currency;
document.querySelector('#currencySelect').addEventListener('change',e=>{currency=e.target.value;localStorage.setItem('lendwiseCurrency',currency);renderRows();renderUpcoming();document.querySelector('#paymentPreview').textContent=money(calculate());});
document.querySelector('#saveLoan').addEventListener('click',e=>{if(!form.reportValidity()){e.preventDefault();return}e.preventDefault();const fd=new FormData(form);const due=new Date(fd.get('due')+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});const item={name:fd.get('name'),phone:fd.get('phone'),amount:+fd.get('amount'),months:+fd.get('months'),payment:Math.round(calculate()),due,progress:0,score:75,status:'On track',color:'#d8eadf',address:fd.get('address'),referrer:fd.get('referrer'),family:fd.get('family')};saved.unshift(item);localStorage.setItem('lendwiseBorrowers',JSON.stringify(saved));borrowers.unshift(item);renderRows();renderUpcoming();modal.close();form.reset();document.querySelector('#paymentPreview').textContent='$0.00';showToast(`${item.name} was added successfully.`)});
document.querySelector('#searchInput').addEventListener('input',e=>renderRows(borrowers.filter(b=>b.name.toLowerCase().includes(e.target.value.toLowerCase()))));
document.querySelector('#exportBtn').onclick=()=>{const cols=['Name','Phone','Loan Amount','Monthly Payment','Next Due','Score','Status'];const rows=borrowers.map(b=>[b.name,b.phone,b.amount,b.payment,b.due,b.score,b.status]);const csv=[cols,...rows].map(r=>r.map(v=>`"${v}"`).join(',')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='lendwise-portfolio.csv';a.click();URL.revokeObjectURL(a.href);showToast('Excel-compatible report downloaded.')};
document.querySelector('#enableAlerts').onclick=async()=>{if(!('Notification' in window))return showToast('Notifications are not supported here.');const result=await Notification.requestPermission();showToast(result==='granted'?'Payment reminders are enabled.':'Notification permission was not granted.')};
function showToast(msg){document.querySelector('#toastText').textContent=msg;const t=document.querySelector('#toast');t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3000)}
