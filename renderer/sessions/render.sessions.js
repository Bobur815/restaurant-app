import { showAlert } from "../../utils/alert.js";

const clickSound = new Audio(new URL('../../sounds/mixkit.wav', import.meta.url));
clickSound.preload = 'auto';

export async function loadSessionsPage(){

    const sessionList = document.querySelector('#sessionList')
    const openSessionBtn = document.getElementById('session-open-btn')

    openSessionBtn.addEventListener('click', async (e) => {
        clickSound.currentTime = 0;
        clickSound.play().catch(() => {});
        e.preventDefault()
        await window.electronAPI.openSessionAddWindow()
    })

    let query = {}
    sessionList.innerHTML = `<tr><td colspan="10">⏳ Yuklanmoqda...</td></tr>`;
    try {
        const res = await fetch(`http://localhost:3000/api/session`)

        if(res.ok){
            const sessions = await res.json()
            if(!sessions.length){
                sessionList.innerHTML = `<tr><td colspan="9">📭 Sessiyalar topilmadi</td></tr>`;
            }
            loadSessions(sessions)
        } else{
             showAlert("❌ Yuklashda xatolik");
        }
    } catch (error) {
        
    }
}

export async function loadSessions(){
    const openDateSession = document.querySelector('#open-date-of-session')


}