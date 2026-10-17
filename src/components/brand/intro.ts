// A plain module (not "use client"), so the server layout gets the string itself.

/**
 * Runs in <head> before first paint (layout.tsx): marks <html data-intro>
 * "seen" (the splash already played this session, so it is hidden) or "skip"
 * (a tap or key, which fades it at once, even before React is up).
 */
export const INTRO_SCRIPT = `try{var d=document.documentElement,k="sports-social-intro-"+(location.pathname.indexOf("/play")===0?"phone":"host");if(sessionStorage.getItem(k))d.dataset.intro="seen";else{sessionStorage.setItem(k,"1");var s=function(){if(d.dataset.intro!=="seen")d.dataset.intro="skip"};addEventListener("pointerdown",s,{once:true});addEventListener("keydown",s,{once:true})}}catch(e){}`;
