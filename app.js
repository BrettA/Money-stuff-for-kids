
const AGE_KEY='msfk-age';
const allowed=['preschool','elementary','middle','high'];
function setAge(age){
 if(!allowed.includes(age)) age='elementary';
 localStorage.setItem(AGE_KEY,age);
 document.querySelectorAll('.age-pill').forEach(b=>b.classList.toggle('active',b.dataset.age===age));
 document.querySelectorAll('[data-age-copy]').forEach(el=>el.classList.toggle('active',el.dataset.ageCopy===age));
 document.querySelectorAll('.current-age-label').forEach(el=>el.textContent=({'preschool':'Preschool','elementary':'Elementary School','middle':'Middle School','high':'High School'})[age]);
 const select=document.querySelector('#agePreference'); if(select) select.value=age;
}
document.addEventListener('DOMContentLoaded',()=>{
 setAge(localStorage.getItem(AGE_KEY)||'elementary');
 document.querySelectorAll('.age-pill').forEach(b=>b.addEventListener('click',()=>setAge(b.dataset.age)));
 const form=document.querySelector('#signupForm');
 if(form){
   form.addEventListener('submit',async(e)=>{
     e.preventDefault();
     const status=document.querySelector('#signupStatus'); status.textContent='Signing you up…';
     const fd=new FormData(form);
     try{
       const r=await fetch('https://formsubmit.co/ajax/brettaiinbox@gmail.com',{method:'POST',headers:{'Accept':'application/json'},body:fd});
       const j=await r.json();
       if(!r.ok) throw new Error(j.message||'Unable to subscribe');
       status.textContent='Check your inbox — you’re on the list.';
       form.reset(); setAge(localStorage.getItem(AGE_KEY)||'elementary');
     }catch(err){status.textContent='Signup did not go through. Please try again.'}
   })
 }
});
