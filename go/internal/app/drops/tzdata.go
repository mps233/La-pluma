package drops

// Embed the IANA time zone database so Asia/Shanghai business dates resolve on
// Windows and minimal containers, matching Node's bundled ICU data.
import _ "time/tzdata"
