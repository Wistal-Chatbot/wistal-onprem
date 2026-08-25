# Chatbot Wistal — jak zacząć

Krótka instrukcja dla pracownika. Nic nie instalujesz — aplikacja działa na
firmowym serwerze, Ty tylko otwierasz ją w przeglądarce.

## Adres

**https://chatbot.wistal.com.pl**

Działa **wyłącznie z sieci firmowej Wistal**. Z domu, z komórki po LTE ani przez
VPN spoza firmy nie wejdziesz — aplikacja nie jest wystawiona do internetu i tak
ma zostać.

## Trzy rzeczy, które mogą zaskoczyć przy pierwszym wejściu

### 1. „Nie można znaleźć serwera"

Nazwa `chatbot.wistal.com.pl` nie jest jeszcze wpisana do firmowego DNS-u, więc
komputer może jej nie rozpoznawać. Obejście na własnej maszynie:

1. Uruchom **Notatnik jako administrator** (prawy klik na ikonie → „Uruchom jako
   administrator" — bez tego nie zapiszesz pliku).
2. Otwórz `C:\Windows\System32\drivers\etc\hosts`
   (w oknie wyboru pliku przełącz filtr na „Wszystkie pliki").
3. Dopisz na końcu linię:

   ```
   192.168.1.188 chatbot.wistal.com.pl
   ```

4. Zapisz i odśwież przeglądarkę.

Samo `192.168.1.188` w pasku adresu **nie zadziała** — serwer odpowiada tylko
pod nazwą domenową.

### 2. Ostrzeżenie o certyfikacie

Przeglądarka pokaże „Połączenie nie jest prywatne" albo podobne. **To jest
spodziewane i bezpieczne w tym przypadku.** Certyfikat wystawia wewnętrzny
urząd certyfikacji serwera, a nie publiczny — połączenie jest szyfrowane, tylko
przeglądarka nie zna wystawcy.

Klikasz „Zaawansowane" → „Przejdź do chatbot.wistal.com.pl". Ostrzeżenie zniknie
docelowo, gdy dojdzie prawdziwy certyfikat.

### 3. Logowanie kodem z e-maila

Nie ma hasła. Podajesz swój **służbowy adres `@wistal.com.pl`**, dostajesz
mailem kod jednorazowy, wpisujesz go i jesteś w środku. Konto tworzy się samo
przy pierwszym udanym logowaniu.

Adresy spoza domeny `@wistal.com.pl` są odrzucane, chyba że administrator doda
je wyjątkiem.

> **Uwaga na dziś:** wysyłka maili nie jest jeszcze w pełni skonfigurowana —
> dopóki domena `wistal.com.pl` nie zostanie zweryfikowana u dostawcy poczty,
> kody dochodzą tylko na jeden adres. Jeśli kod nie przychodzi, to nie jest
> Twój błąd — zgłoś się do administratora.

## Co potrafi aplikacja

- **Czat** — pytasz po polsku o dane z Optimy („ile sprzedaliśmy klientowi X
  w tym roku", „jakie mamy stany magazynowe na towarze Y"), dostajesz odpowiedź
  wraz z tabelą wyników.
- **Dane** — ręczne przeglądanie tabel z filtrowaniem i sortowaniem, bez pisania
  zapytań.
- **Raporty AI** — gotowe, powtarzalne zestawienia.

## Skąd biorą się dane i jak są świeże

Dane pochodzą z **Comarch Optima** i są kopiowane na serwer chatbota
automatycznie, **co 15 minut**, plus pełne odświeżenie raz na dobę w nocy.
Widzisz więc stan sprzed najwyżej kilkunastu minut, a nie na żywo.

Dostępne obszary: kontrahenci, towary ze stanami magazynowymi, faktury sprzedaży
i zakupu wraz z pozycjami, zamówienia do dostawców oraz powiązania między
dokumentami. Dane sięgają 2016 roku.

## Czy mogę coś popsuć?

Nie. Aplikacja ma dostęp do Optimy i do kopii danych **wyłącznie w trybie
odczytu** — każde zapytanie generowane przez model jest sprawdzane i odrzucane,
jeśli próbowałoby cokolwiek zmienić. Nie da się przez czat zmodyfikować ani
skasować niczego w Optimie.

## Coś nie działa

Zbierz trzy rzeczy i zgłoś administratorowi: **treść pytania**, które zadałeś,
**co odpowiedziała aplikacja** i **godzinę**. Po tym da się odtworzyć, co
poszło nie tak — każde wykonane zapytanie jest zapisywane.

Jeśli odpowiedź wygląda na merytorycznie błędną (złe liczby, pominięte
dokumenty), zgłoś to koniecznie — to najcenniejsza informacja zwrotna na tym
etapie i najszybsza droga do poprawienia opisu danych, z którego korzysta model.
