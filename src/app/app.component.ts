import { Component, HostListener } from '@angular/core';
import { KeyBinder } from '@thegraid/easeljs-lib';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  title = 'titans';
  timestamp = `${new Date().toLocaleTimeString('en-US')}`;

  constructor(private keyBinder: KeyBinder) { }

  // app.component has access to the 'Host', so we use @HostListener here
  // Listen to all Host events and forward them to our internal EventDispatcher
  @HostListener('document:keyup', ['$event'])
  @HostListener('document:keydown', ['$event'])
  @HostListener('mouseenter', ['$event'])
  @HostListener('mouseleave', ['$event'])
  @HostListener('focus', ['$event'])
  @HostListener('blur', ['$event'])
  dispatchAnEvent(event: Object) {
    //console.log("dispatch: "+event.type);
    this.keyBinder.dispatchEvent(event);
  }
}
