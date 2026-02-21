import { Inter } from "next/font/google";


import "./globals.css";
import TopBar from "./components/top-bar";
import Providers from "./providers";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter"
});

export const metadata = {
  title: "PhotoX",
  description: "Personal photo platform"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&icon_names=add,add_photo_alternate,admin_panel_settings,arrow_back,arrow_forward,broken_image,calendar_today,camera,check,check_circle,chevron_left,chevron_right,close,cloud_upload,database,delete,download,edit,error,event,expand_more,favorite,folder_open,group,history,image,info,label,location_on,lock,lock_reset,login,mail,menu,notes,notifications,person,photo_album,photo_camera,photo_library,progress_activity,search,select_all,settings,share,speed,tune,upload,videocam,visibility,visibility_off"
        />
      </head>
      <body className={`${inter.variable} bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 font-sans antialiased`}>
        <Providers>
          <TopBar />
          {children}
        </Providers>
      </body>
    </html>
  );
}
