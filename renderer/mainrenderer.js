window.addEventListener('DOMContentLoaded', () => {

    const asosiy = document.querySelector("#asosiy")
    const menu = document.querySelector("#menu")
    const buyurtma = document.querySelector("#buyurtma")
    const cheklar = document.querySelector("#cheklar")
    const hisobotlar = document.querySelector("#hisobotlar")
    const settings = document.querySelector("#settings")
    const chiqish = document.querySelector("#chiqish")
    const sidebarItems = document.querySelectorAll('.sidebar li');

    sidebarItems.forEach(item => {
        item.addEventListener('click', () => {
        sidebarItems.forEach(i => i.classList.remove('active'));

        item.classList.add('active');
        });
    });

    asosiy.addEventListener("click", (e) => {
        e.preventDefault();
        console.log("asosiy"); 
    })
    menu.addEventListener("click", (e) => {
        e.preventDefault();
        console.log("menu"); 
    })
    buyurtma.addEventListener("click", (e) => {
        e.preventDefault();
        console.log("buyurtma"); 
    })
    cheklar.addEventListener("click", (e) => {
        e.preventDefault();
        console.log("cheklar"); 
    })
    hisobotlar.addEventListener("click", (e) => {
        e.preventDefault();
        console.log("hisobotlar"); 
    })
    settings.addEventListener("click", (e) => {
        e.preventDefault();
        console.log("settings"); 
    })
    chiqish.addEventListener("click", (e) => {
        e.preventDefault();
        console.log("chiqish"); 
    })

});